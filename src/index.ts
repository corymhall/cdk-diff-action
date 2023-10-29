import * as core from '@actions/core';
import { run } from './action';

run().catch((error: any) => {
  core.setFailed(error.message);
});
