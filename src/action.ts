import {
  getInput,
  getBooleanInput,
  getMultilineInput,
  debug,
} from '@actions/core';
import * as github from '@actions/github';
import {
  DiffMethod,
  NonInteractiveIoHost,
  Toolkit,
} from '@aws-cdk/toolkit-lib';
import { Comments } from './comment';
import { Inputs } from './inputs';
import { AssemblyProcessor } from './stage-processor';

export async function run() {
  const inputs: Inputs = {
    title: getInput('title') || undefined,
    defaultStageDisplayName: getInput('defaultStageDisplayName', {
      required: true,
    }),
    allowedDestroyTypes: getMultilineInput('allowedDestroyTypes'),
    failOnDestructiveChanges: getBooleanInput('failOnDestructiveChanges'),
    githubToken: getInput('githubToken'),
    stackSelectorPatterns: getMultilineInput('stackSelectorPatterns'),
    stackSelectionStrategy: getInput('stackSelectionStrategy', {
      required: true,
    }),
    noFailOnDestructiveChanges: getMultilineInput('noFailOnDestructiveChanges'),
    cdkOutDir: getInput('cdkOutDir', { required: true }),
    diffMethod: getInput('diffMethod', { required: true }),
  };

  if (
    inputs.stackSelectorPatterns.length > 0 &&
    inputs.stackSelectionStrategy === 'all-stacks'
  ) {
    inputs.stackSelectionStrategy = 'pattern-must-match';
  }

  debug(`Inputs: ${JSON.stringify(inputs, null, 2)}`);

  const octokit = github.getOctokit(inputs.githubToken);
  const context = github.context;

  const toolkit = new Toolkit({
    ioHost: new NonInteractiveIoHost({
      logLevel: 'info',
    }),
  });
  const method =
    inputs.diffMethod === 'template-only'
      ? DiffMethod.TemplateOnly()
      : DiffMethod.ChangeSet();
  try {
    const comments = new Comments(octokit, context);
    const processor = new AssemblyProcessor({
      ...inputs,
      diffMethod: method,
      toolkit,
    });
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
      throw new Error(
        'There are destructive changes! See PR comment for details.',
      );
    }
  } catch (e: any) {
    console.error('Error performing diff: ', e);
    throw e;
  }
  return;
}
