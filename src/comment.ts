import { Context } from '@actions/github/lib/context';
import { GitHub } from '@actions/github/lib/utils';
import { PullRequestEvent } from '@octokit/webhooks-definitions/schema';

/**
 * GitHub's hard limit on the length of an issue/PR comment body. A request
 * with a longer body is rejected with a "Body is too long" validation error.
 */
const GITHUB_MAX_COMMENT_LENGTH = 65536;

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
   * Assemble the full comment body (hash marker + content + footer).
   *
   * When `truncate` is set and the assembled body would exceed GitHub's
   * comment-size limit, the body is cut to fit and a notice is appended
   * pointing the reader at the Action run logs (which always contain the
   * full, untruncated diff). The hash marker is at the very start, so it
   * always survives truncation and `findPrevious` keeps working. If the cut
   * falls inside a fenced code block, the fence is closed so the notice
   * still renders as Markdown rather than being swallowed by the block.
   */
  private buildBody(
    hash: string,
    content: string[],
    timestamp: string,
    truncate: boolean,
  ): string {
    const footer = `_Generated for commit ${this.commitSha} at ${timestamp}_`;
    const body = [
      `<!-- cdk diff action with hash ${hash} -->`,
      ...content,
      '',
      footer,
    ].join('\n');
    if (!truncate || body.length <= GITHUB_MAX_COMMENT_LENGTH) {
      return body;
    }
    const notice = [
      '',
      '',
      '> [!WARNING]',
      "> **This stack's diff was truncated because it exceeds GitHub's",
      `> ${GITHUB_MAX_COMMENT_LENGTH}-character comment limit.** The full, untruncated diff`,
      '> is available in this job\'s GitHub Actions run logs.',
      '',
      footer,
    ].join('\n');
    // Reserve room for the notice and a possible closing code fence.
    const budget = GITHUB_MAX_COMMENT_LENGTH - notice.length - 5;
    const head = body.slice(0, budget);
    const openFence = (head.match(/```/g) ?? []).length % 2 === 1;
    return head + (openFence ? '\n```' : '') + notice;
  }

  /**
   * Update an existing comment
   *
   * @param hash the unique hash identifying the stage comment to look for
   * @param content the content of the comment
   * @param commentId the id of the comment to update
   * @param opts.truncate cut the body to fit GitHub's size limit instead of
   * letting the request fail with "Body is too long"
   */
  public async updateComment(
    commentId: number,
    hash: string,
    content: string[],
    opts: { truncate?: boolean } = {},
  ) {
    const timestamp = new Date().toISOString();
    await this.octokit.rest.issues.updateComment({
      ...this.context.repo,
      body: this.buildBody(hash, content, timestamp, opts.truncate ?? false),
      comment_id: commentId,
    });
  }

  /**
   * Create a new comment
   *
   * @param hash the unique hash identifying the stage comment to look for
   * @param content the content of the comment
   * @param opts.truncate cut the body to fit GitHub's size limit instead of
   * letting the request fail with "Body is too long"
   */
  public async createComment(
    hash: string,
    content: string[],
    opts: { truncate?: boolean } = {},
  ) {
    const timestamp = new Date().toISOString();
    await this.octokit.rest.issues.createComment({
      ...this.context.repo,
      body: this.buildBody(hash, content, timestamp, opts.truncate ?? false),
      issue_number: this.issueNumber,
    });
  }
}
