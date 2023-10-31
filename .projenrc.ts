import { typescript } from 'projen';
import { Transform } from 'projen/lib/javascript';
import { JsonPatch } from 'projen/lib/json-patch';
import { GitHubActionTypeScriptProject, RunsUsing } from 'projen-github-action-typescript';
const project = new GitHubActionTypeScriptProject({
  defaultReleaseBranch: 'main',
  authorEmail: '43035978+corymhall@users.noreply.github.com',
  authorName: 'Cory Hall',
  name: 'cdk-diff-action',
  projenrcTs: true,
  actionMetadata: {
    author: 'Cory Hall',
    description:
      'The CDK Diff GitHub Action allows you to run CDK diff as part of your CI/CD workflow.',
    inputs: {
      githubToken: {
        description: 'github token',
        required: true,
      },
      allowedDestroyTypes: {
        description: 'Resource types that are allowed to be destroyed',
        required: false,
        default: '',
      },
      failOnDestructiveChanges: {
        description: 'Whether or not destructive changes should fail the job',
        required: false,
        default: 'true',
      },
    },
    runs: {
      using: RunsUsing.NODE_16, // overwrite to node18
      main: 'dist/index.js',
    },
  },
  deps: [
    '@octokit/webhooks-definitions',
    '@aws-cdk/cloudformation-diff',
    '@aws-cdk/cloud-assembly-schema',
    '@actions/exec@^1.1.1',
    '@actions/io@^1.1.3',
    '@actions/tool-cache@^2.0.0',
    'fs-extra',
    '@aws-sdk/client-cloudformation',
    '@smithy/types',
    'chalk@^4',
    '@aws-sdk/credential-providers',
  ],
  devDeps: [
    'mock-fs@^5',
    'aws-sdk-client-mock',
    '@types/mock-fs@^4',
    'projen-github-action-typescript',
    '@types/fs-extra',
    'action-docs',
    '@swc/core',
    '@swc/jest',
  ],
  jestOptions: {
    configFilePath: 'jest.config.json',
  },
  minNodeVersion: '18.12.0',

  // deps: [],                /* Runtime dependencies of this module. */
  // description: undefined,  /* The description is just a string that helps people understand the purpose of the package. */
  // packageName: undefined,  /* The "name" in package.json. */
});

const projenProject = project as unknown as typescript.TypeScriptProject;
const jestConfig = projenProject.tryFindObjectFile('jest.config.json');
jestConfig?.patch(JsonPatch.remove('/preset'));
jestConfig?.patch(JsonPatch.remove('/globals'));
jestConfig?.patch(JsonPatch.add('/transform', {
  '^.+\\.(t|j)sx?$': new Transform('@swc/jest'),
}));
const actionYml = project.tryFindObjectFile('action.yml');
actionYml?.addOverride('runs.using', 'node20');
project.synth();
