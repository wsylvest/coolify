import { z } from "zod";
import {
  createTRPCRouter,
  protectedProcedure,
  teamProcedure,
  adminProcedure,
} from "../trpc";
import { teams, teamMembers, teamInvitations, users } from "@/server/db/schema";
import { eq, and } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { createId } from "@paralleldrive/cuid2";
import { notificationService } from "@/server/services/notifications";
import { logger } from "@/lib/logger";

export const teamsRouter = createTRPCRouter({
  /**
   * List all teams the user belongs to
   */
  list: protectedProcedure.query(async ({ ctx }) => {
    const userTeams = await ctx.db.query.teamMembers.findMany({
      where: eq(teamMembers.userId, ctx.session.user.id),
      with: {
        team: true,
      },
    });

    return userTeams.map((tm) => ({
      ...tm.team,
      role: tm.role,
    }));
  }),

  /**
   * Get team by ID
   */
  getById: teamProcedure
    .input(z.object({ teamId: z.string() }))
    .query(async ({ ctx, input }) => {
      const team = await ctx.db.query.teams.findFirst({
        where: eq(teams.id, input.teamId),
        with: {
          members: {
            with: {
              user: {
                columns: {
                  id: true,
                  name: true,
                  email: true,
                  avatarUrl: true,
                },
              },
            },
          },
        },
      });

      if (!team) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Team not found",
        });
      }

      // Verify user is a member
      const isMember = team.members.some(
        (m) => m.userId === ctx.session.user.id
      );
      if (!isMember) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You are not a member of this team",
        });
      }

      return team;
    }),

  /**
   * Create a new team
   */
  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(2).max(255),
        description: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const [team] = await ctx.db
        .insert(teams)
        .values({
          name: input.name,
          description: input.description,
          personalTeam: false,
        })
        .returning();

      if (!team) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create team",
        });
      }

      // Add creator as owner
      await ctx.db.insert(teamMembers).values({
        teamId: team.id,
        userId: ctx.session.user.id,
        role: "owner",
      });

      return team;
    }),

  /**
   * Update team settings
   */
  update: adminProcedure
    .input(
      z.object({
        teamId: z.string(),
        name: z.string().min(2).max(255).optional(),
        description: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { teamId, ...updateData } = input;

      const [updated] = await ctx.db
        .update(teams)
        .set(updateData)
        .where(eq(teams.id, teamId))
        .returning();

      return updated;
    }),

  /**
   * Delete a team
   */
  delete: adminProcedure
    .input(z.object({ teamId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // Check if it's a personal team
      const team = await ctx.db.query.teams.findFirst({
        where: eq(teams.id, input.teamId),
      });

      if (team?.personalTeam) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Cannot delete personal team",
        });
      }

      await ctx.db.delete(teams).where(eq(teams.id, input.teamId));

      return { success: true };
    }),

  /**
   * List team members
   */
  listMembers: teamProcedure
    .input(z.object({ teamId: z.string() }))
    .query(async ({ ctx, input }) => {
      const members = await ctx.db.query.teamMembers.findMany({
        where: eq(teamMembers.teamId, input.teamId),
        with: {
          user: {
            columns: {
              id: true,
              name: true,
              email: true,
              avatarUrl: true,
            },
          },
        },
      });

      return members;
    }),

  /**
   * Invite a user to the team
   */
  invite: adminProcedure
    .input(
      z.object({
        teamId: z.string(),
        email: z.string().email(),
        role: z.enum(["admin", "member"]).default("member"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Check if user is already a member
      const existingUser = await ctx.db.query.users.findFirst({
        where: eq(users.email, input.email),
      });

      if (existingUser) {
        const existingMember = await ctx.db.query.teamMembers.findFirst({
          where: and(
            eq(teamMembers.teamId, input.teamId),
            eq(teamMembers.userId, existingUser.id)
          ),
        });

        if (existingMember) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "User is already a member of this team",
          });
        }
      }

      // Check for existing invitation
      const existingInvite = await ctx.db.query.teamInvitations.findFirst({
        where: and(
          eq(teamInvitations.teamId, input.teamId),
          eq(teamInvitations.email, input.email)
        ),
      });

      if (existingInvite) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "An invitation has already been sent to this email",
        });
      }

      const inviteUuid = createId();
      const inviteLink = `${process.env.NEXT_PUBLIC_APP_URL}/invite/${inviteUuid}`;

      const [invitation] = await ctx.db
        .insert(teamInvitations)
        .values({
          teamId: input.teamId,
          email: input.email,
          role: input.role,
          invitedBy: ctx.session.user.id,
          link: inviteLink,
          uuid: inviteUuid,
        })
        .returning();

      // Get team name for the email
      const team = await ctx.db.query.teams.findFirst({
        where: eq(teams.id, input.teamId),
      });

      // Get inviter's name
      const inviter = await ctx.db.query.users.findFirst({
        where: eq(users.id, ctx.session.user.id),
      });

      // Send invitation email
      try {
        await notificationService.sendEmail({
          to: input.email,
          subject: `You've been invited to join ${team?.name ?? "a team"} on Coolify`,
          html: `
            <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
              <h2>Team Invitation</h2>
              <p>Hi,</p>
              <p><strong>${inviter?.name ?? "Someone"}</strong> has invited you to join the team <strong>${team?.name ?? "their team"}</strong> on Coolify.</p>
              <p>Role: <strong>${input.role}</strong></p>
              <p style="margin: 30px 0;">
                <a href="${inviteLink}" style="background-color: #7c3aed; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
                  Accept Invitation
                </a>
              </p>
              <p style="color: #666; font-size: 14px;">
                Or copy this link: ${inviteLink}
              </p>
              <p style="color: #999; font-size: 12px; margin-top: 40px;">
                If you didn't expect this invitation, you can ignore this email.
              </p>
            </div>
          `,
          text: `You've been invited to join ${team?.name ?? "a team"} on Coolify by ${inviter?.name ?? "someone"}. Role: ${input.role}. Accept the invitation: ${inviteLink}`,
        });
        logger.info("Team invitation email sent", { email: input.email, teamId: input.teamId });
      } catch (error) {
        logger.error("Failed to send team invitation email", { error, email: input.email });
      }

      return invitation;
    }),

  /**
   * Accept an invitation
   */
  acceptInvitation: protectedProcedure
    .input(z.object({ invitationUuid: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const invitation = await ctx.db.query.teamInvitations.findFirst({
        where: eq(teamInvitations.uuid, input.invitationUuid),
      });

      if (!invitation) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Invitation not found",
        });
      }

      // Verify the invitation email matches the user
      if (invitation.email !== ctx.session.user.email) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "This invitation was sent to a different email address",
        });
      }

      // Add user to team
      await ctx.db.insert(teamMembers).values({
        teamId: invitation.teamId,
        userId: ctx.session.user.id,
        role: invitation.role,
      });

      // Delete the invitation
      await ctx.db
        .delete(teamInvitations)
        .where(eq(teamInvitations.id, invitation.id));

      return { success: true };
    }),

  /**
   * Remove a member from the team
   */
  removeMember: adminProcedure
    .input(
      z.object({
        teamId: z.string(),
        userId: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Cannot remove yourself
      if (input.userId === ctx.session.user.id) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Cannot remove yourself from the team",
        });
      }

      await ctx.db
        .delete(teamMembers)
        .where(
          and(
            eq(teamMembers.teamId, input.teamId),
            eq(teamMembers.userId, input.userId)
          )
        );

      return { success: true };
    }),

  /**
   * Update member role
   */
  updateMemberRole: adminProcedure
    .input(
      z.object({
        teamId: z.string(),
        userId: z.string(),
        role: z.enum(["admin", "member"]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Cannot change owner role
      const member = await ctx.db.query.teamMembers.findFirst({
        where: and(
          eq(teamMembers.teamId, input.teamId),
          eq(teamMembers.userId, input.userId)
        ),
      });

      if (member?.role === "owner") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Cannot change owner's role",
        });
      }

      const [updated] = await ctx.db
        .update(teamMembers)
        .set({ role: input.role })
        .where(
          and(
            eq(teamMembers.teamId, input.teamId),
            eq(teamMembers.userId, input.userId)
          )
        )
        .returning();

      return updated;
    }),
});
