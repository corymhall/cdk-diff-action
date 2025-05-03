import { IIoHost, IoMessage, IoRequest } from '@aws-cdk/toolkit-lib';

export class FakeIoHost implements IIoHost {
  notify(_msg: IoMessage<unknown>): Promise<void> {
    return Promise.resolve();
  }
  requestResponse<T, U>(_msg: IoRequest<T, U>): Promise<U> {
    return Promise.resolve({} as U);
  }
}
