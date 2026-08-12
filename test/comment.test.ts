import type { GitHub } from '@actions/github/lib/utils';
import { Comments } from '../src/comment';

type Context = typeof import('@actions/github').context;

jest.mock('@actions/core', () => ({ debug: jest.fn() }));

const createComment = jest.fn();
const updateComment = jest.fn();
const listComments = jest.fn();
const issues = { createComment, updateComment, listComments };

const rest = { issues };
const octokit = { rest } as unknown as InstanceType<typeof GitHub>;
let timestamp = '';

const context: Context = {
  sha: 'some-sha',
  payload: {
    repository: {
      full_name: 'some-repo',
    },
    pull_request: {
      head: { sha: '123' },
      number: 1,
    },
  },
} as unknown as Context;
// const pullRequestData = {
//   data: {
//     items: [
//       {
//         number: 1,
//       },
//     ],
//   },
// };
const hash = '761811df765e65db8321b6c4002ca358';
const commentDataWithTag = {
  data: [
    {
      id: 1,
      body: 'some comment',
    },
    {
      id: 2,
      body: `<!-- cdk diff action with hash ${hash} -->\nprevious-message`,
    },
  ],
};

const commentDataWithUnMatchedTag = {
  data: [
    {
      id: 1,
      body: 'some comment',
    },
    {
      id: 2,
      body: '<!-- cdk diff action with hash SOME-DIFFERENT-HASH -->\nprevious-message',
    },
  ],
};

beforeEach(() => {
  createComment.mockClear();
  updateComment.mockClear();
  jest.useFakeTimers({
    now: new Date('2021-02-26T22:42:16.652Z'),
    advanceTimers: true,
  });
  timestamp = new Date().toISOString();
});

describe('comments', () => {
  test('found previous comment with hash', async () => {
    listComments.mockResolvedValue(commentDataWithTag);
    const comments = new Comments(octokit, context);
    await expect(comments.findPrevious(hash)).resolves.toEqual(2);
  });

  test('found previous comment with different hash', async () => {
    listComments.mockResolvedValue(commentDataWithUnMatchedTag);
    const comments = new Comments(octokit, context);
    await expect(comments.findPrevious(hash)).resolves.toBeUndefined();
  });

  test('no comments', async () => {
    listComments.mockResolvedValue({ data: [] });
    const comments = new Comments(octokit, context);
    await expect(comments.findPrevious(hash)).resolves.toBeUndefined();
  });

  test('update comment', async () => {
    updateComment.mockResolvedValue({});
    const comments = new Comments(octokit, context);
    expect(comments.updateComment(1, hash, ['message'])).resolves;
    expect(updateComment).toHaveBeenCalledWith({
      ...context.repo,
      body: [
        `<!-- cdk diff action with hash ${hash} -->`,
        'message',
        '',
        `_Generated for commit ${context.payload.pull_request?.head.sha} at ${timestamp}_`,
      ].join('\n'),
      comment_id: 1,
    });
  });

  test('create comment', async () => {
    createComment.mockResolvedValue({});
    const comments = new Comments(octokit, context);
    expect(comments.createComment(hash, ['message'])).resolves;
    expect(createComment).toHaveBeenCalledWith({
      ...context.repo,
      body: [
        `<!-- cdk diff action with hash ${hash} -->`,
        'message',
        '',
        `_Generated for commit ${context.payload.pull_request?.head.sha} at ${timestamp}_`,
      ].join('\n'),
      issue_number: context.payload.pull_request?.number,
    });
  });

  test('oversized diff is replaced with a run-log pointer; surrounding text kept', async () => {
    createComment.mockResolvedValue({});
    const comments = new Comments(octokit, context);
    const hugeDiff = 'x'.repeat(70000);
    const content = [
      '### Diff for stack: SomeStage / my-stack',
      '#### Diff for stack: my-stack - ***1 to add, 0 to update, 0 to destroy*** :sparkle:',
      '<details><summary>Details</summary>',
      '',
      '```shell',
      hugeDiff,
      '```',
      '</details>',
      '',
    ];
    await comments.createComment(hash, content);
    const body: string = createComment.mock.calls[0][0].body;
    // Fits within GitHub's hard comment-size limit.
    expect(body.length).toBeLessThanOrEqual(65536);
    // Surrounding text survives: hash marker, headers, details wrapper, footer.
    expect(body).toContain(`<!-- cdk diff action with hash ${hash} -->`);
    expect(body).toContain('### Diff for stack: SomeStage / my-stack');
    expect(body).toContain('</details>');
    expect(body).toContain(
      `_Generated for commit ${context.payload.pull_request?.head.sha}`,
    );
    // The raw diff is gone, replaced by a pointer to the run logs.
    expect(body).not.toContain(hugeDiff);
    expect(body).toContain('GitHub Actions run logs');
  });

  test('a comment that fits keeps its diff intact', async () => {
    createComment.mockResolvedValue({});
    const comments = new Comments(octokit, context);
    const diff = 'Resources\n[+] AWS::IAM::Role MyRole';
    await comments.createComment(hash, ['```shell', diff, '```']);
    const body: string = createComment.mock.calls[0][0].body;
    expect(body).toContain(diff);
    expect(body).not.toContain('GitHub Actions run logs');
  });

  test('fits() reflects GitHub size limit', () => {
    const comments = new Comments(octokit, context);
    expect(comments.fits(hash, ['small diff'])).toBe(true);
    expect(comments.fits(hash, ['```shell', 'x'.repeat(70000), '```'])).toBe(
      false,
    );
  });
});
