import { createQueue } from "../index";

export interface ServiceJobData {
  serviceId: string;
}

export const serviceQueue = createQueue<ServiceJobData>("service");
