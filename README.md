# CDK Diff Action

GitHub action to comment on PRs with the stack diff.

![](./diff-screenshot.png)

## :sparkles: Features

- :speech_balloon: Create a single comment per CDK stage
- :recycle: Updates the same comment on each commit, reducing clutter
- :bangbang: Calls out any destructive changes to resources
- :x: Fail workflow if there are destructive changes
- :thread: Summary of stack changes with expandable details
- :see_no_evil: Allow destructive changes for certain resource types

## Example Configurations

The `cdk-diff-action` handles performing the diff and commenting on the PR. In
order to do so it requires credentials to AWS and the synthesized CDK cloud
assembly (cdk.out). Below is a minimal example

```yml
name: diff
on:
  pull_request:
    branches:
      - main
jobs:
  Synth:
    name: Synthesize
    permissions:
      contents: read
      pull-requests: write
      id-token: write
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4
      - name: Setup Node
        uses: actions/setup-node@v3
        with:
          node-version: 20
      - name: Install dependencies
        run: yarn install --frozen-lockfile
      - name: Synth
        run: npx cdk synth
      - name: Authenticate Via OIDC Role
        uses: aws-actions/configure-aws-credentials@v4
        with:
          aws-region: us-east-2
          role-duration-seconds: 1800
          role-skip-session-tagging: true
          role-to-assume: arn:aws:iam::1234567891012:role/cdk_github_actions
          role-session-name: github
      - name: Diff
        uses: corymhall/cdk-diff-action@v1
        with:
          githubToken: ${{ secrets.GITHUB_TOKEN }}
```
