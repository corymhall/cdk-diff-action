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
  await processor.processStages();
  await processor.commentStages(comments);
  return;
}

