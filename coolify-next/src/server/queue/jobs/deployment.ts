import { createQueue } from "../index";

export interface DeploymentJobData {
  deploymentId: string;
  applicationId: string;
}

export interface StopJobData {
  applicationId: string;
}

export interface RestartJobData {
  deploymentId: string;
  applicationId: string;
}

export const deploymentQueue = createQueue<
  DeploymentJobData | StopJobData | RestartJobData
>("deployment");
