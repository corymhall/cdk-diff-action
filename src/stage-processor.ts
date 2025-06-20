import * as crypto from 'crypto';
import { Writable, WritableOptions } from 'stream';
import { StringDecoder } from 'string_decoder';
import { debug } from '@actions/core';
import { TemplateDiff, formatDifferences } from '@aws-cdk/cloudformation-diff';
import { CloudAssembly } from '@aws-cdk/cx-api';
import {
  DiffMethod,
  StackSelectionStrategy,
  StackSelector,
  Toolkit,
} from '@aws-cdk/toolkit-lib';
import type { RequestError, OctokitResponse } from '@octokit/types';
import { AssemblyManifestReader, StackInfo, StageInfo } from './assembly';
import { Comments } from './comment';
import { ChangeDetails, StackDiff, StackDiffInfo, StageDiffInfo } from './diff';
import { Inputs } from './inputs';

/**
 * Information needed to make a comment for a CDK Stage
 */
interface StageComment {
  /**
   * The full comment for each stack. The list will be joined with \n
   */
  stackComments: { [stackName: string]: string[] };

  /**
   * The title of the comment
   */
  title?: string;

  /**
   * The unique hash for the stage comment
   * This will be used to lookup the stage comment on the PR
   * so that it can be overwritten
   */
  hash: string;

  /**
   * The number of destructive changes in this stage
   */
  destructiveChanges: number;
}

export interface AssemblyProcessorOptions
  extends Omit<Inputs, 'githubToken' | 'diffMethod'> {
  diffMethod: DiffMethod;
  toolkit: Toolkit;
  defaultStageDisplayName: string;
}

/**
 * StageProcessor processes a CDK stage and creates a comment on the GitHub PR
 * detailing the stack diffs
 */
export class AssemblyProcessor {
  /**
   * @internal
   */
  public readonly stageComments: { [stageName: string]: StageComment } = {};
  private _stageInfo?: StageInfo[];
  private _stages?: StageDiffInfo[];
  private _templateDiffs?: { [stackName: string]: TemplateDiff };
  constructor(private options: AssemblyProcessorOptions) {}

  private get stageInfo(): StageInfo[] {
    if (!this._stageInfo) {
      throw new Error('Stage info has not been created yet');
    }
    return this._stageInfo;
  }

  private processAssembly(cloudAssembly: CloudAssembly) {
    const assembly = new AssemblyManifestReader(
      cloudAssembly,
      this.templateDiffs,
    );
    this._stageInfo = assembly.stages;
    if (assembly.stacks.length) {
      this.stageInfo.push({
        name: this.options.defaultStageDisplayName,
        stacks: assembly.stacks,
      });
    }
  }

  private get templateDiffs(): { [stackName: string]: TemplateDiff } {
    if (!this._templateDiffs) {
      throw new Error('Template diffs have not been created yet');
    }
    return this._templateDiffs;
  }

  private get stageDiffInfo(): StageDiffInfo[] {
    if (this._stages) {
      return this._stages;
    }
    this._stages = this.stageInfo.flatMap((stage) => {
      this.stageComments[stage.name] = {
        title: this.options.title,
        destructiveChanges: 0,
        stackComments: stage.stacks.reduce(
          (prev, curr) => {
            prev[curr.name] = [];
            return prev;
          },
          {} as { [stackName: string]: string[] },
        ),
        hash: md5Hash(
          JSON.stringify({
            stageName: stage.name,
            title: this.options.title,
            ...stage.stacks.reduce(
              (prev, curr) => {
                prev.stacks.push({
                  name: curr.name,
                });
                return prev;
              },
              { stacks: [] } as { stacks: StackInfo[] },
            ),
          }),
        ),
      };
      return {
        name: stage.name,
        stacks: stage.stacks.map((stack) => {
          if (!this.templateDiffs[stack.name]) {
            throw new Error(
              `Template diffs have not been created yet for stack ${stack.name}`,
            );
          }
          return {
            stackName: stack.name,
            diff: this.templateDiffs[stack.name],
          };
        }),
      };
    });
    return this._stages;
  }

  public async diffApp(): Promise<{ [name: string]: TemplateDiff }> {
    const assemblySource = await this.options.toolkit.fromAssemblyDirectory(
      this.options.cdkOutDir,
      {
        // When checkVersion=true it means users can't upgrade their CDK version before
        // we do and they pull in the new action version. Probably better to default to false
        // and see what happens
        loadAssemblyOptions: { checkVersion: false },
        failOnMissingContext: false,
      },
    );

    const selector: StackSelector =
      this.options.stackSelectorPatterns.length > 0
        ? {
            strategy: this.options
              .stackSelectionStrategy as StackSelectionStrategy,
            patterns: this.options.stackSelectorPatterns,
          }
        : {
            strategy: this.options
              .stackSelectionStrategy as StackSelectionStrategy,
          };
    const diffResult = await this.options.toolkit.diff(assemblySource, {
      stacks: selector,
      method: this.options.diffMethod,
    });

    this._templateDiffs = diffResult;
    await using cloudAssembly = await assemblySource.produce();
    this.processAssembly(cloudAssembly.cloudAssembly);
    return diffResult;
  }

  /**
   * Process all of the stages. Once this has been run
   * the comment can be created with `commentStages()`
   */
  public async processStages(ignoreDestructiveChanges: string[] = []) {
    if (!this._templateDiffs) {
      await this.diffApp();
    }
    debug(`Diffs: ${JSON.stringify(this._templateDiffs, null, 2)}`);
    for (const stage of this.stageDiffInfo) {
      for (const stack of stage.stacks) {
        try {
          const { comment, changes } = await this.diffStack(stack);
          debug(
            `Diff for stack ${stack.stackName}: ${JSON.stringify(comment, null, 2)}`,
          );
          this.stageComments[stage.name].stackComments[stack.stackName].push(
            ...comment,
          );
          if (!ignoreDestructiveChanges.includes(stage.name)) {
            this.stageComments[stage.name].destructiveChanges += changes;
          }
        } catch (e: any) {
          console.error('Error processing stages: ', e);
          throw e;
        }
      }
    }
  }

  private async commentStack(
    comments: Comments,
    stageName: string,
    stackName: string,
    comment: string[],
  ) {
    const hash = md5Hash(
      JSON.stringify({
        title: this.options.title,
        stageName,
        stackName,
      }),
    );
    const stackComment = this.getCommentForStack(stageName, stackName, comment);
    const previous = await comments.findPrevious(hash);
    try {
      if (previous) {
        await comments.updateComment(previous, hash, stackComment);
      } else {
        await comments.createComment(hash, stackComment);
      }
    } catch (e: any) {
      this.handleError(
        e,
        `Comment for stack ${stackName} is too long, please report this as a bug https://github.com/corymhall/cdk-diff-action/issues/new`,
      );
    }
  }

  /**
   * Try to comment all the individual stacks
   * Do it in parallel so that we don't stop if one of them fails
   */
  private async commentStacks(
    comments: Comments,
    stageName: string,
    stage: StageComment,
  ) {
    const commentPromises: Promise<void>[] = [];
    for (const [stackName, comment] of Object.entries(stage.stackComments)) {
      commentPromises.push(
        this.commentStack(comments, stageName, stackName, comment),
      );
    }
    const res = await Promise.allSettled(commentPromises);
    const failed = res
      .filter((r) => r.status === 'rejected')
      .flatMap((r) => r.reason);
    if (failed && failed.length > 0) {
      throw new Error('Error commenting stacks: \n' + failed.join('\n'));
    }
  }

  private bodyTooLongError(e: any): boolean {
    if (e.response) {
      const err = e.response as OctokitResponse<RequestError, number>;
      return (
        err.data.errors?.some((er) =>
          er.message?.includes('Body is too long'),
        ) ?? false
      );
    }
    return false;
  }

  private handleError(e: any, message: string) {
    if (this.bodyTooLongError(e)) {
      throw new Error(message);
    }
    throw e;
  }

  private async commentStage(
    comments: Comments,
    hash: string,
    comment: string[],
  ) {
    const previous = await comments.findPrevious(hash);
    if (previous) {
      await comments.updateComment(previous, hash, comment);
    } else {
      await comments.createComment(hash, comment);
    }
  }

  /**
   * Create the GitHub comment for the stage
   * This will try to create a single comment per stage, but if the comment
   * is too long it will create a comment per stack
   * @param comments the comments object to use to create the comment
   */
  public async commentStages(comments: Comments) {
    for (const [stageName, comment] of Object.entries(this.stageComments)) {
      const stageComment = this.getCommentForStage(stageName);
      try {
        await this.commentStage(comments, comment.hash, stageComment);
      } catch (e: any) {
        if (
          this.bodyTooLongError(e) &&
          Object.keys(comment.stackComments).length > 1
        ) {
          await this.commentStacks(comments, stageName, comment);
        } else {
          throw e;
        }
      }
    }
  }

  /**
   * Returns whether or not there are destructive changes in this stage
   */
  public get hasDestructiveChanges(): boolean {
    for (const comments of Object.values(this.stageComments)) {
      if (comments.destructiveChanges) {
        return true;
      }
    }
    return false;
  }

  private async diffStack(
    stack: StackDiffInfo,
  ): Promise<{ comment: string[]; changes: number }> {
    try {
      const stackDiff = new StackDiff(stack, this.options.allowedDestroyTypes);
      const { diff, changes } = await stackDiff.diffStack();
      return {
        comment: this.formatStackComment(stack.stackName, diff, changes),
        changes: changes.destructiveChanges.length,
      };
    } catch (e: any) {
      console.error('Error performing stack diff: ', e);
      throw e;
    }
  }

  private getEmoji(changes: ChangeDetails): string {
    if (changes.destructiveChanges.length || changes.removedResources) {
      return ':x:';
    } else if (changes.updatedResources) {
      return ':yellow_circle:';
    } else if (changes.createdResources) {
      return ':sparkle:';
    }
    return ':white_check_mark:';
  }

  private formatStackComment(
    stackName: string,
    diff: TemplateDiff,
    changes: ChangeDetails,
  ): string[] {
    const output: string[] = [];
    const emoji = this.getEmoji(changes);
    if (diff.isEmpty) {
      output.push(`No Changes for stack: ${stackName} ${emoji}`);
      return output;
    }
    output.push(
      ...[
        `#### Diff for stack: ${stackName} - ` +
          `***${changes.createdResources} to add, ${changes.updatedResources} to update, ${changes.removedResources} to destroy***  ` +
          emoji,
        '<details><summary>Details</summary>',
        '',
      ],
    );
    if (changes.destructiveChanges.length) {
      output.push('');
      output.push('> [!WARNING]\n> ***Destructive Changes*** :bangbang:'),
        changes.destructiveChanges.forEach((change) => {
          output.push(
            `> **Stack: ${change.stackName} - Resource: ${change.logicalId} - Impact:** ***${change.impact}***`,
          );
          output.push('');
        });
    }
    const writable = new StringWritable({});
    formatDifferences(writable, diff);

    output.push('');
    output.push('```shell');
    output.push(writable.data);
    output.push('```');
    output.push('</details>');
    output.push('');
    return output;
  }

  /**
   * Only used when the stage comment is too long and we are creating
   * a separate comment for each stack
   */
  private getCommentForStack(
    stageName: string,
    stackName: string,
    comment: string[],
  ): string[] {
    const output: string[] = [];
    if (!comment.length) {
      return output;
    }
    if (this.options.title) {
      output.push(`## ${this.options.title}`);
      output.push('');
    }
    output.push(`### Diff for stack: ${stageName} / ${stackName}`);

    return output.concat(comment);
  }

  private getCommentForStage(stageName: string): string[] {
    const output: string[] = [];
    const stageComments = this.stageComments[stageName];
    const comments = Object.values(
      this.stageComments[stageName].stackComments,
    ).flatMap((x) => x);
    if (!comments.length) {
      return output;
    }
    if (this.options.title) {
      output.push(`## ${this.options.title}`);
      output.push('');
    }
    output.push(`### Diff for stage: ${stageName}`);

    if (stageComments.destructiveChanges) {
      output.push(
        `> [!WARNING]\n> ${stageComments.destructiveChanges} Destructive Changes`,
      );
      output.push('');
    }
    return output.concat(comments);
  }
}

class StringWritable extends Writable {
  public data: string;
  private _decoder: StringDecoder;
  constructor(options: WritableOptions) {
    super(options);
    this._decoder = new StringDecoder();
    this.data = '';
  }

  _write(
    chunk: any,
    encoding: string,
    callback: (error?: Error | null) => void,
  ): void {
    if (encoding === 'buffer') {
      chunk = this._decoder.write(chunk);
    }

    this.data += chunk;
    callback();
  }

  _final(callback: (error?: Error | null) => void): void {
    this.data += this._decoder.end();
    callback();
  }
}

function md5Hash(val: string): string {
  return crypto.createHash('md5').update(val).digest('hex');
}
