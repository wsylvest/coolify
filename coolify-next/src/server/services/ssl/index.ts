import { sshService, type SSHConnectionConfig } from "../ssh";
import { logger } from "@/lib/logger";
import { createId } from "@paralleldrive/cuid2";

export type SslProvider = "letsencrypt" | "custom" | "self_signed";
export type ChallengeType = "http" | "dns" | "tls-alpn";

export interface SslCertificateInfo {
  domain: string;
  issuer: string;
  validFrom: Date;
  validTo: Date;
  serialNumber: string;
  fingerprint: string;
}

export interface AcmeAccountConfig {
  email: string;
  provider: "letsencrypt" | "letsencrypt_staging" | "zerossl";
}

export interface CertificateRequestOptions {
  domains: string[];
  email: string;
  challengeType: ChallengeType;
  staging?: boolean;
}

class SslService {
  private readonly ACME_SH_IMAGE = "neilpang/acme.sh";
  private readonly COOLIFY_DIR = "/data/coolify";
  private readonly CERT_DIR = "/data/coolify/ssl";

  /**
   * Issue a certificate using Let's Encrypt (via acme.sh)
   */
  async issueCertificate(
    sshConfig: SSHConnectionConfig,
    options: CertificateRequestOptions
  ): Promise<{
    success: boolean;
    certificate?: string;
    privateKey?: string;
    chain?: string;
    error?: string;
  }> {
    const certId = createId();
    const certPath = `${this.CERT_DIR}/${certId}`;

    try {
      // Create cert directory
      await sshService.executeCommand({
        ...sshConfig,
        command: `mkdir -p ${certPath}`,
      });

      // Determine ACME server
      const acmeServer = options.staging
        ? "https://acme-staging-v02.api.letsencrypt.org/directory"
        : "https://acme-v02.api.letsencrypt.org/directory";

      // Build domain arguments
      const domainArgs = options.domains.map((d) => `-d ${d}`).join(" ");

      // Run acme.sh in Docker
      let issueCommand: string;

      switch (options.challengeType) {
        case "http":
          // HTTP challenge - requires port 80 to be accessible
          issueCommand = `docker run --rm \\
            -v ${this.CERT_DIR}/acme:/acme.sh \\
            -v ${certPath}:/certs \\
            -p 80:80 \\
            ${this.ACME_SH_IMAGE} \\
            --issue \\
            ${domainArgs} \\
            --standalone \\
            --server ${acmeServer} \\
            --accountemail ${options.email} \\
            --cert-file /certs/cert.pem \\
            --key-file /certs/key.pem \\
            --fullchain-file /certs/fullchain.pem`;
          break;

        case "tls-alpn":
          // TLS-ALPN challenge - requires port 443 to be accessible
          issueCommand = `docker run --rm \\
            -v ${this.CERT_DIR}/acme:/acme.sh \\
            -v ${certPath}:/certs \\
            -p 443:443 \\
            ${this.ACME_SH_IMAGE} \\
            --issue \\
            ${domainArgs} \\
            --alpn \\
            --server ${acmeServer} \\
            --accountemail ${options.email} \\
            --cert-file /certs/cert.pem \\
            --key-file /certs/key.pem \\
            --fullchain-file /certs/fullchain.pem`;
          break;

        default:
          return {
            success: false,
            error: `Unsupported challenge type: ${options.challengeType}`,
          };
      }

      logger.info(`Issuing certificate for domains: ${options.domains.join(", ")}`);

      const result = await sshService.executeCommand({
        ...sshConfig,
        command: issueCommand,
        timeout: 300000, // 5 minutes
      });

      if (!result.success) {
        return {
          success: false,
          error: result.stderr || "Failed to issue certificate",
        };
      }

      // Read the generated certificates
      const [certResult, keyResult, chainResult] = await Promise.all([
        sshService.readFile({ ...sshConfig, remotePath: `${certPath}/cert.pem` }),
        sshService.readFile({ ...sshConfig, remotePath: `${certPath}/key.pem` }),
        sshService.readFile({ ...sshConfig, remotePath: `${certPath}/fullchain.pem` }),
      ]);

      return {
        success: true,
        certificate: certResult,
        privateKey: keyResult,
        chain: chainResult,
      };
    } catch (error) {
      logger.error("Failed to issue certificate", { error });
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Renew a certificate
   */
  async renewCertificate(
    sshConfig: SSHConnectionConfig,
    domain: string
  ): Promise<{
    success: boolean;
    certificate?: string;
    privateKey?: string;
    chain?: string;
    error?: string;
  }> {
    try {
      const result = await sshService.executeCommand({
        ...sshConfig,
        command: `docker run --rm \\
          -v ${this.CERT_DIR}/acme:/acme.sh \\
          ${this.ACME_SH_IMAGE} \\
          --renew -d ${domain} --force`,
        timeout: 300000,
      });

      if (!result.success) {
        return {
          success: false,
          error: result.stderr || "Failed to renew certificate",
        };
      }

      // Get the cert path from acme.sh
      const certDir = `${this.CERT_DIR}/acme/${domain}`;

      const [certResult, keyResult, chainResult] = await Promise.all([
        sshService.readFile({ ...sshConfig, remotePath: `${certDir}/${domain}.cer` }),
        sshService.readFile({ ...sshConfig, remotePath: `${certDir}/${domain}.key` }),
        sshService.readFile({ ...sshConfig, remotePath: `${certDir}/fullchain.cer` }),
      ]);

      return {
        success: true,
        certificate: certResult,
        privateKey: keyResult,
        chain: chainResult,
      };
    } catch (error) {
      logger.error("Failed to renew certificate", { error, domain });
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Generate a self-signed certificate
   */
  async generateSelfSignedCertificate(
    sshConfig: SSHConnectionConfig,
    domain: string,
    validDays = 365
  ): Promise<{
    success: boolean;
    certificate?: string;
    privateKey?: string;
    error?: string;
  }> {
    const certId = createId();
    const certPath = `${this.CERT_DIR}/${certId}`;

    try {
      // Create cert directory
      await sshService.executeCommand({
        ...sshConfig,
        command: `mkdir -p ${certPath}`,
      });

      // Generate self-signed certificate using OpenSSL
      const result = await sshService.executeCommand({
        ...sshConfig,
        command: `openssl req -x509 -nodes -days ${validDays} \\
          -newkey rsa:2048 \\
          -keyout ${certPath}/key.pem \\
          -out ${certPath}/cert.pem \\
          -subj "/CN=${domain}" \\
          -addext "subjectAltName=DNS:${domain}"`,
      });

      if (!result.success) {
        return {
          success: false,
          error: result.stderr || "Failed to generate certificate",
        };
      }

      const [certResult, keyResult] = await Promise.all([
        sshService.readFile({ ...sshConfig, remotePath: `${certPath}/cert.pem` }),
        sshService.readFile({ ...sshConfig, remotePath: `${certPath}/key.pem` }),
      ]);

      return {
        success: true,
        certificate: certResult,
        privateKey: keyResult,
      };
    } catch (error) {
      logger.error("Failed to generate self-signed certificate", { error, domain });
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Install a custom certificate
   */
  async installCustomCertificate(
    sshConfig: SSHConnectionConfig,
    options: {
      domain: string;
      certificate: string;
      privateKey: string;
      certificateChain?: string;
    }
  ): Promise<{ success: boolean; error?: string }> {
    const certPath = `${this.CERT_DIR}/custom/${options.domain}`;

    try {
      // Create directory
      await sshService.executeCommand({
        ...sshConfig,
        command: `mkdir -p ${certPath}`,
      });

      // Write certificate files
      await Promise.all([
        sshService.writeFile({
          ...sshConfig,
          remotePath: `${certPath}/cert.pem`,
          content: options.certificate,
        }),
        sshService.writeFile({
          ...sshConfig,
          remotePath: `${certPath}/key.pem`,
          content: options.privateKey,
        }),
        options.certificateChain
          ? sshService.writeFile({
              ...sshConfig,
              remotePath: `${certPath}/chain.pem`,
              content: options.certificateChain,
            })
          : Promise.resolve(),
      ]);

      // Set proper permissions
      await sshService.executeCommand({
        ...sshConfig,
        command: `chmod 600 ${certPath}/*.pem`,
      });

      return { success: true };
    } catch (error) {
      logger.error("Failed to install custom certificate", { error, domain: options.domain });
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Get certificate information
   */
  async getCertificateInfo(
    sshConfig: SSHConnectionConfig,
    certPath: string
  ): Promise<SslCertificateInfo | null> {
    try {
      const result = await sshService.executeCommand({
        ...sshConfig,
        command: `openssl x509 -in ${certPath} -noout -dates -issuer -serial -fingerprint`,
      });

      if (!result.success) {
        return null;
      }

      const output = result.stdout;

      // Parse the output
      const notBeforeMatch = output.match(/notBefore=(.+)/);
      const notAfterMatch = output.match(/notAfter=(.+)/);
      const issuerMatch = output.match(/issuer=(.+)/);
      const serialMatch = output.match(/serial=(.+)/);
      const fingerprintMatch = output.match(/SHA256 Fingerprint=(.+)/);

      // Get subject (domain)
      const subjectResult = await sshService.executeCommand({
        ...sshConfig,
        command: `openssl x509 -in ${certPath} -noout -subject`,
      });

      const subjectMatch = subjectResult.stdout.match(/CN\s*=\s*([^,\n]+)/);

      return {
        domain: subjectMatch?.[1]?.trim() ?? "unknown",
        issuer: issuerMatch?.[1]?.trim() ?? "unknown",
        validFrom: new Date(notBeforeMatch?.[1]?.trim() ?? 0),
        validTo: new Date(notAfterMatch?.[1]?.trim() ?? 0),
        serialNumber: serialMatch?.[1]?.trim() ?? "unknown",
        fingerprint: fingerprintMatch?.[1]?.trim() ?? "unknown",
      };
    } catch (error) {
      logger.error("Failed to get certificate info", { error, certPath });
      return null;
    }
  }

  /**
   * Check if certificate is expiring soon
   */
  async isCertificateExpiringSoon(
    sshConfig: SSHConnectionConfig,
    certPath: string,
    daysThreshold = 30
  ): Promise<{ expiring: boolean; daysRemaining: number }> {
    try {
      const result = await sshService.executeCommand({
        ...sshConfig,
        command: `openssl x509 -in ${certPath} -checkend ${daysThreshold * 86400}`,
      });

      // Get exact expiration
      const infoResult = await sshService.executeCommand({
        ...sshConfig,
        command: `openssl x509 -in ${certPath} -noout -enddate`,
      });

      const match = infoResult.stdout.match(/notAfter=(.+)/);
      const expiryDate = match ? new Date(match[1].trim()) : new Date();
      const daysRemaining = Math.floor(
        (expiryDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24)
      );

      return {
        expiring: !result.success,
        daysRemaining,
      };
    } catch (error) {
      logger.error("Failed to check certificate expiry", { error, certPath });
      return { expiring: true, daysRemaining: 0 };
    }
  }

  /**
   * List all certificates on a server
   */
  async listCertificates(
    sshConfig: SSHConnectionConfig
  ): Promise<
    {
      path: string;
      domain: string;
      expiresAt: Date;
      daysRemaining: number;
    }[]
  > {
    try {
      // Find all certificate files
      const result = await sshService.executeCommand({
        ...sshConfig,
        command: `find ${this.CERT_DIR} -name "*.pem" -o -name "*.cer" | head -50`,
      });

      if (!result.success) {
        return [];
      }

      const certFiles = result.stdout.split("\n").filter(Boolean);
      const certificates: {
        path: string;
        domain: string;
        expiresAt: Date;
        daysRemaining: number;
      }[] = [];

      for (const certPath of certFiles) {
        // Skip key files
        if (certPath.includes("key")) continue;

        const info = await this.getCertificateInfo(sshConfig, certPath);
        if (info) {
          const daysRemaining = Math.floor(
            (info.validTo.getTime() - Date.now()) / (1000 * 60 * 60 * 24)
          );
          certificates.push({
            path: certPath,
            domain: info.domain,
            expiresAt: info.validTo,
            daysRemaining,
          });
        }
      }

      return certificates;
    } catch (error) {
      logger.error("Failed to list certificates", { error });
      return [];
    }
  }

  /**
   * Delete a certificate
   */
  async deleteCertificate(
    sshConfig: SSHConnectionConfig,
    domain: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      // Remove from acme.sh
      await sshService.executeCommand({
        ...sshConfig,
        command: `docker run --rm \\
          -v ${this.CERT_DIR}/acme:/acme.sh \\
          ${this.ACME_SH_IMAGE} \\
          --remove -d ${domain}`,
      });

      // Remove custom certs
      await sshService.executeCommand({
        ...sshConfig,
        command: `rm -rf ${this.CERT_DIR}/custom/${domain}`,
      });

      return { success: true };
    } catch (error) {
      logger.error("Failed to delete certificate", { error, domain });
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }
}

export const sslService = new SslService();
