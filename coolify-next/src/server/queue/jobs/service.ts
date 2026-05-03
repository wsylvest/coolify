import { createQueue } from "../index";

export interface ServiceStartJobData {
  type: "start";
  serviceId: string;
}

export interface ServiceStopJobData {
  type: "stop";
  serviceId: string;
}

export interface ServiceRestartJobData {
  type: "restart";
  serviceId: string;
}

export type ServiceJobData = ServiceStartJobData | ServiceStopJobData | ServiceRestartJobData;

export const serviceQueue = createQueue<ServiceJobData>("service");

// Helper functions to queue jobs with correct type
export const queueServiceStart = (serviceId: string) =>
  serviceQueue.add("start", { type: "start", serviceId });

export const queueServiceStop = (serviceId: string) =>
  serviceQueue.add("stop", { type: "stop", serviceId });

export const queueServiceRestart = (serviceId: string) =>
  serviceQueue.add("restart", { type: "restart", serviceId });
