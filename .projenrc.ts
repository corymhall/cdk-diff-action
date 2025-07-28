import { github, typescript } from 'projen';
import {
  NodePackageManager,
  Transform,
  UpgradeDependenciesSchedule,
} from 'projen/lib/javascript';
import { JsonPatch } from 'projen/lib/json-patch';
import {
  GitHubActionTypeScriptProject,
  RunsUsing,
} from 'projen-github-action-typescript';
const project = new GitHubActionTypeScriptProject({
  majorVersion: 2,
  defaultReleaseBranch: 'main',
  authorEmail: '43035978+corymhall@users.noreply.github.com',
  authorName: 'Cory Hall',
  packageManager: NodePackageManager.NPM,
  name: 'cdk-diff-action',
  githubOptions: {
    mergify: false,
  },
  projenrcTs: true,
  depsUpgradeOptions: {
    exclude: ['@aws-cdk/cloud-assembly-schema'],
    workflowOptions: {
      labels: ['auto-approve'],
      schedule: UpgradeDependenciesSchedule.WEEKLY,
    },
  },
  autoApproveOptions: {
    label: 'auto-approve',
    allowedUsernames: ['corymhall'],
  },
  actionMetadata: {
    author: 'Cory Hall',
    branding: {
      color: 'orange',
      icon: 'message-square',
    },
    description:
      'The CDK Diff GitHub Action allows you to run CDK diff as part of your CI/CD workflow.',
    name: 'cdk-diff-action',
    inputs: {
      githubToken: {
        description: 'github token',
        required: true,
      },
      allowedDestroyTypes: {
        description:
          'Comma delimited list of resource types that are allowed to be destroyed',
        required: false,
        default: '',
      },
      failOnDestructiveChanges: {
        description: 'Whether or not destructive changes should fail the job',
        required: false,
        default: 'true',
      },
      stackSelectorPatterns: {
        description:
          'Comma delimited list of stack selector patterns. Use this to control which stages/stacks to diff. By default all stages & stacks are diffed\n\n' +
          '@see https://github.com/aws/aws-cdk-cli/tree/main/packages/%40aws-cdk/toolkit-lib#stack-selection',
        required: false,
        default: '',
      },
      stackSelectionStrategy: {
        description: [
          'Used in combination with "stackSelectorPatterns" to control which stacks to diff.',
          '',
          'Valid values are "all-stacks", "main-assembly", "only-single", "pattern-match",',
          '"pattern-must-match", "pattern-must-match-single"',
          '',
          '@default pattern-must-match if "stackSelectorPatterns" is provided, otherwise "all-stacks"',
          '@see https://github.com/aws/aws-cdk-cli/tree/main/packages/%40aws-cdk/toolkit-lib#stack-selection',
        ].join('\n'),
        default: 'all-stacks',
        required: false,
      },
      noFailOnDestructiveChanges: {
        description:
          'List of stages where breaking changes will not fail the build',
        required: false,
        default: '',
      },
      cdkOutDir: {
        description: 'The location of the CDK output directory',
        required: false,
        default: 'cdk.out',
      },
      diffMethod: {
        description: [
          'The method to create a stack diff.',
          '',
          "Valid values are 'change-set' or 'template-only'.",
          '',
          'Use changeset diff for the highest fidelity, including analyze resource replacements.',
          'In this method, diff will use the deploy role instead of the lookup role.',
          '',
          "Use template-only diff for a faster, less accurate diff that doesn't require",
          'permissions to create a change-set.',
        ].join('\n'),
        required: false,
        default: 'change-set',
      },
      defaultStageDisplayName: {
        description: 'An optional display name for the CDK default stage.',
        required: false,
        default: 'DefaultStage',
      },
      title: {
        description: 'An optional title for each diff comment on the PR.',
        required: false,
        default: '',
      },
    },
    runs: {
      using: RunsUsing.NODE_20,
      main: 'dist/index.js',
    },
  },
  prettier: true,
  prettierOptions: {
    settings: {
      singleQuote: true,
    },
  },
  eslintOptions: {
    dirs: [],
    prettier: true,
  },
  deps: [
    '@aws-cdk/cloudformation-diff',
    '@aws-cdk/cx-api',
    '@aws-cdk/toolkit-lib',
    '@octokit/webhooks-definitions',
    '@aws-cdk/cloud-assembly-schema',
    'fs-extra',
  ],
  devDeps: [
    'mock-fs@^5',
    '@types/mock-fs@^4',
    'projen-github-action-typescript',
    '@types/fs-extra',
    'action-docs',
    '@swc/core',
    '@swc/jest',
  ],
  tsconfig: {
    compilerOptions: {
      lib: ['es2022', 'esnext'],
    },
  },
  tsconfigDev: {
    compilerOptions: {
      lib: ['es2022', 'esnext'],
    },
  },
  jestOptions: {
    configFilePath: 'jest.config.json',
  },
  minNodeVersion: '20',
});

const projenProject = project as unknown as typescript.TypeScriptProject;

// There doesn't seem to be a way to specify --target for individual dependencies so
// adding a separate task to handle always doing a major upgrade to `@aws-cdk/cloud-assembly-schema`
// @see https://github.com/aws/aws-cdk/blob/main/packages/aws-cdk-lib/cloud-assembly-schema/README.md#versioning
project.upgradeWorkflow?.postUpgradeTask.prependSpawn(
  projenProject.addTask('upgrade-cloud-assembly-schema', {
    env: {
      CI: '0',
    },
    steps: [
      {
        exec: 'npx npm-check-updates@16 --upgrade --target=latest --peer --dep=prod --filter=@aws-cdk/cloud-assembly-schema',
      },
      { exec: 'npm install' },
      { exec: 'npm update @aws-cdk/cloud-assembly-schema' },
      { exec: 'npx projen' },
    ],
  }),
);

const jestConfig = projenProject.tryFindObjectFile('jest.config.json');
jestConfig?.patch(JsonPatch.remove('/preset'));
jestConfig?.patch(JsonPatch.remove('/globals'));
jestConfig?.patch(
  JsonPatch.add('/transform', {
    '^.+\\.(t|j)sx?$': new Transform('@swc/jest'),
  }),
);
project.tasks.addTask('gh-release', {
  exec: 'ts-node projenrc/release-version.ts',
});

// setup merge queue
const buildWorkflow = project.github?.tryFindWorkflow('build');
buildWorkflow?.on({
  mergeGroup: {
    branches: ['main'],
  },
});
buildWorkflow?.file?.patch(
  JsonPatch.replace(
    '/jobs/build/steps/4/run',
    [
      'git add .',
      'git diff --staged --patch --binary --exit-code > repo.patch || echo "self_mutation_happened=true" >> $GITHUB_OUTPUT',
    ].join('\n'),
  ),
);
buildWorkflow?.file?.patch(
  JsonPatch.add('/jobs/build/steps/5/with/retention-days', 1),
);

project.tasks.tryFind('release')?.spawn(
  project.addTask('copy-files', {
    exec: [
      'cp package.json dist/',
      'cp package-lock.json dist/',
      'cp -r projenrc dist/',
      'cp tsconfig.json dist/',
    ].join(' && '),
  }),
);

const releaseWorkflow = project.github?.tryFindWorkflow('release');
releaseWorkflow?.file?.patch(
  JsonPatch.add('/jobs/release/steps/8/with/retention-days', 1),
);
releaseWorkflow?.file?.patch(
  JsonPatch.replace(
    '/jobs/release_github/steps/3/run',
    [
      'mv dist/package.json ./',
      'mv dist/package-lock.json ./',
      'mv dist/projenrc ./',
      'mv dist/tsconfig.json ./',
      'npm ci',
      'npx ts-node projenrc/release-version.ts',
    ].join('\n'),
  ),
);

project.gitignore.exclude('dist/package.json');
project.gitignore.exclude('dist/projenrc');
project.gitignore.exclude('dist/bin');

const autoMergeJob: github.workflows.Job = {
  name: 'Set AutoMerge on PR #${{ github.event.number }}',
  runsOn: ['ubuntu-latest'],
  permissions: {
    pullRequests: github.workflows.JobPermission.WRITE,
    contents: github.workflows.JobPermission.WRITE,
  },
  steps: [
    {
      uses: 'peter-evans/enable-pull-request-automerge@v2',
      with: {
        token: '${{ secrets.PROJEN_GITHUB_TOKEN }}',
        'pull-request-number': '${{ github.event.number }}',
        'merge-method': 'SQUASH',
      },
    },
  ],
};

projenProject.github
  ?.tryFindWorkflow('auto-approve')
  ?.file?.patch(
    JsonPatch.replace(
      '/jobs/approve/steps/0/uses',
      'hmarr/auto-approve-action@v3',
    ),
  );

const workflow = projenProject.github?.addWorkflow('auto-merge');
workflow?.on({
  // The 'pull request' event gives the workflow 'read-only' permissions on some
  // pull requests (such as the ones from dependabot) when using the `GITHUB_TOKEN`
  // security token. This prevents the workflow from approving these pull requests.
  // Github has placed this guard so as to prevent security attacks by simply opening
  // a pull request and triggering a workflow on a commit that was not vetted to make
  // unintended changes to the repository.
  //
  // Instead use the 'pull request target' event here that gives the Github workflow
  // 'read-write' permissions. This is safe because, this event, unlike the 'pull request'
  // event references the BASE commit of the pull request and not the HEAD commit.
  //
  // We only enable auto-merge when a PR is opened, reopened or moving from Draft to Ready.
  // That way a user can always disable auto-merge if they want to and the workflow will
  // not automatically re-enable it, unless one of the events occurs.
  pullRequestTarget: {
    types: ['opened', 'reopened', 'ready_for_review'],
  },
});

projenProject.packageTask.reset();
projenProject.packageTask.exec(
  'cp node_modules/@aws-cdk/aws-service-spec/db.json.gz ./ && ncc build --external fsevents --source-map --license licenses.txt',
);
workflow?.addJobs({ enableAutoMerge: autoMergeJob });

project.synth();
