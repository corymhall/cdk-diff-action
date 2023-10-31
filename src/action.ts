import { getInput, getBooleanInput } from '@actions/core';
import * as github from '@actions/github';
import { AssemblyManifestReader } from './assembly';
import { Comments } from './comment';
import { StageProcessor } from './diff';
import { Inputs } from './inputs';

export async function run() {
  const inputs: Inputs = {
    allowedDestroyTypes: getInput('allowedDestroyTypes').split(','),
    failOnDestructiveChanges: getBooleanInput('failOnDestructiveChanges'),
    githubToken: getInput('githubToken'),
  };
  const octokit = github.getOctokit(inputs.githubToken);
  const context = github.context;
  try {
    const assembly = AssemblyManifestReader.fromPath('cdk.out');
    let stages = assembly.stages;
    if (!stages.length) {
      stages = [{
        name: 'DefaultStage',
        stacks: assembly.stacks,
      }];
    }
    const comments = new Comments(octokit, context);
    const processor = new StageProcessor(stages, inputs.allowedDestroyTypes);
    try {
      await processor.processStages();
    } catch (e: any) {
      console.error('Error running process stages: ', e);
      throw e;
    }

    try {
      await processor.commentStages(comments);

    } catch (e: any) {
      console.error('Error commenting stages: ', e);
      throw e;
    }

    if (processor.hasDestructiveChanges && inputs.failOnDestructiveChanges) {
      throw new Error('There are destructive changes! See PR comment for details.');
    }
  } catch (e: any) {
    console.error('Error performing diff: ', e);
    throw e;
  }
  return;
}

