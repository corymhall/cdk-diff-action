import { Context } from '@actions/github/lib/context';
import { GitHub } from '@actions/github/lib/utils';
import { PullRequestEvent } from '@octokit/webhooks-definitions/schema';

/**
 * Comments controls interacting with GitHub to make comments
 */
export class Comments {
  private readonly issueNumber: number;
  private readonly commitSha: string;
  constructor(
    private readonly octokit: InstanceType<typeof GitHub>,
    private readonly context: Context,
  ) {
    const payload = context.payload as PullRequestEvent;
    this.commitSha = payload.pull_request.head.sha;
    if (!payload.pull_request.number) {
      throw new Error('Cannot find PR number, is this from a pull request?');
    }
    this.issueNumber = this.context.payload.pull_request?.number!;
  }

  /**
   * Find the previous comment with the given hash
   *
   * @param hash the unique hash identifying the stage comment to look for
   * @returns the PR comment id or undefined if there is no previous comment
   */
  public async findPrevious(hash: string): Promise<number | undefined> {
    const comments = await this.octokit.rest.issues.listComments({
      ...this.context.repo,
      issue_number: this.issueNumber,
    });
    return comments.data.find((comment) => comment.body?.includes(hash))?.id;
  }

  /**
   * Update an existing comment
   *
   * @param hash the unique hash identifying the stage comment to look for
   * @param content the content of the comment
   * @param commentId the id of the comment to update
   */
  public async updateComment(
    commentId: number,
    hash: string,
    content: string[],
  ) {
    const timestamp = new Date().toISOString();
    await this.octokit.rest.issues.updateComment({
      ...this.context.repo,
      body: [
        `<!-- cdk diff action with hash ${hash} -->`,
        ...content,
        '',
        `_Generated for commit ${this.commitSha} at ${timestamp}_`,
      ].join('\n'),
      comment_id: commentId,
    });
  }

  /**
   * Create a new comment
   *
   * @param hash the unique hash identifying the stage comment to look for
   * @param content the content of the comment
   */
  public async createComment(hash: string, content: string[]) {
    const timestamp = new Date().toISOString();
    await this.octokit.rest.issues.createComment({
      ...this.context.repo,
      body: [
        `<!-- cdk diff action with hash ${hash} -->`,
        ...content,
        '',
        `_Generated for commit ${this.commitSha} at ${timestamp}_`,
      ].join('\n'),
      issue_number: this.issueNumber,
    });
  }
}
