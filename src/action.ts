import { getInput, getBooleanInput } from '@actions/core';
import * as github from '@actions/github';
import { AssemblyManifestReader } from './assembly';
import { Comments } from './comment';
import { Inputs } from './inputs';
import { StageProcessor } from './stage-processor';

export async function run() {
  const inputs: Inputs = {
    allowedDestroyTypes: getInput('allowedDestroyTypes').split(','),
    failOnDestructiveChanges: getBooleanInput('failOnDestructiveChanges'),
    githubToken: getInput('githubToken'),
    noDiffForStages: getInput('noDiffForStages').split(','),
    noFailOnDestructiveChanges: getInput('noFailOnDestructiveChanges').split(','),
    cdkOutDir: getInput('cdkOutDir') ?? 'cdk.out',
  };
  const octokit = github.getOctokit(inputs.githubToken);
  const context = github.context;
  try {
    const assembly = AssemblyManifestReader.fromPath(inputs.cdkOutDir);
    var stages = assembly.stages;
    if (assembly.stacks.length) {
      stages.push({
        name: 'DefaultStage',
        stacks: assembly.stacks,
      });
    }
    if (inputs.noDiffForStages.length) {
      stages = stages.filter( stage => !inputs.noDiffForStages.includes(stage.name) );
    }
    const comments = new Comments(octokit, context);
    const processor = new StageProcessor(stages, inputs.allowedDestroyTypes);
    try {
      await processor.processStages(inputs.noFailOnDestructiveChanges);
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

