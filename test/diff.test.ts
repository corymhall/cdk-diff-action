import * as path from 'path';
import * as core from '@actions/core';
import { ResourceImpact } from '@aws-cdk/cloudformation-diff';
import {
  DiffMethod,
  StackSelectionStrategy,
  Toolkit,
} from '@aws-cdk/toolkit-lib';
import mock from 'mock-fs';
import { FakeIoHost } from './util';
import { StackDiff } from '../src/diff';

jest.spyOn(core, 'debug').mockImplementation(() => {});

const toolkit = new Toolkit({
  ioHost: new FakeIoHost(),
});

const cdkout = {
  'manifest.json': JSON.stringify({
    version: '17.0.0',
    artifacts: {
      'test-stack': {
        type: 'aws:cloudformation:stack',
        environment: 'aws://1234567891012/us-east-1',
        properties: {
          templateFile: 'test-stack.template.json',
          validateOnSynth: false,
        },
        displayName: 'test-stack',
      },
    },
  }),
  'test-stack.template.json': JSON.stringify({
    Resources: {
      MyRole: {
        Type: 'AWS::IAM::Role',
        Properties: {
          RoleName: 'MyCustomName',
        },
      },
    },
  }),
};

describe('StackDiff', () => {
  beforeEach(() => {
    mock({
      node_modules: mock.load(path.join(__dirname, '..', 'node_modules')),
      'cdk.out': cdkout,
    });
  });
  afterEach(() => {
    mock.restore();
  });

  test('no template diff', async () => {
    // GIVEN
    const assembly = await toolkit.fromAssemblyDirectory('cdk.out');
    const templateDiffs = await toolkit.diff(assembly, {
      stacks: { strategy: StackSelectionStrategy.ALL_STACKS },
      method: DiffMethod.LocalFile('cdk.out/test-stack.template.json'),
    });
    const stackDiff = new StackDiff(
      {
        diff: templateDiffs['test-stack'],
        stackName: 'test-stack',
      },
      [],
    );

    // WHEN
    const { diff, changes } = await stackDiff.diffStack();

    // THEN
    expect(diff.isEmpty).toEqual(true);
    expect(changes).toEqual({
      updatedResources: 0,
      removedResources: 0,
      createdResources: 0,
      destructiveChanges: [],
      unknownEnvironment: undefined,
    });
  });

  test('diff with changes', async () => {
    // GIVEN
    const out = cdkout;
    out['test-stack2.template.json'] = JSON.stringify({
      Resources: {
        MyRole2: {
          Type: 'AWS::IAM::Role',
          Properties: {
            RoleName: 'MyCustomName2',
          },
        },
      },
    });
    mock({
      node_modules: mock.load(path.join(__dirname, '..', 'node_modules')),
      'cdk.out': out,
    });
    const assembly = await toolkit.fromAssemblyDirectory('cdk.out');
    const templateDiffs = await toolkit.diff(assembly, {
      stacks: { strategy: StackSelectionStrategy.ALL_STACKS },
      method: DiffMethod.LocalFile('cdk.out/test-stack2.template.json'),
    });
    const stackDiff = new StackDiff(
      {
        diff: templateDiffs['test-stack'],
        stackName: 'test-stack',
      },
      [],
    );

    // WHEN
    const { diff, changes } = await stackDiff.diffStack();

    // THEN
    expect(diff.isEmpty).toEqual(false);
    expect(changes).toEqual({
      updatedResources: 0,
      removedResources: 1,
      createdResources: 1,
      destructiveChanges: [
        {
          impact: ResourceImpact.WILL_DESTROY,
          logicalId: 'MyRole2',
          stackName: 'test-stack',
        },
      ],
    });
  });

  test('diff with no destructive changes', async () => {
    // GIVEN
    const out = cdkout;
    out['test-stack2.template.json'] = JSON.stringify({
      Resources: {
        MyRole: {
          Type: 'AWS::IAM::Role',
          Properties: {
            RoleName: 'MyCustomName',
            Description: 'New Description',
          },
        },
      },
    });
    mock({
      node_modules: mock.load(path.join(__dirname, '..', 'node_modules')),
      'cdk.out': out,
    });
    const assembly = await toolkit.fromAssemblyDirectory('cdk.out');
    const templateDiffs = await toolkit.diff(assembly, {
      stacks: { strategy: StackSelectionStrategy.ALL_STACKS },
      method: DiffMethod.LocalFile('cdk.out/test-stack2.template.json'),
    });
    const stackDiff = new StackDiff(
      {
        diff: templateDiffs['test-stack'],
        stackName: 'test-stack',
      },
      [],
    );

    // WHEN
    const { diff, changes } = await stackDiff.diffStack();

    // THEN
    expect(diff.isEmpty).toEqual(false);
    expect(diff.differenceCount).toEqual(1);
    expect(diff.resources.changes.MyRole.changeImpact).toEqual(
      ResourceImpact.WILL_UPDATE,
    );
    expect(changes).toEqual({
      updatedResources: 1,
      removedResources: 0,
      createdResources: 0,
      destructiveChanges: [],
    });
  });

  test('diff with destructive changes', async () => {
    // GIVEN
    const out = cdkout;
    out['test-stack2.template.json'] = JSON.stringify({
      Resources: {
        MyRole: {
          Type: 'AWS::IAM::Role',
          Properties: {
            RoleName: 'MyCustomName2',
          },
        },
      },
    });
    mock({
      node_modules: mock.load(path.join(__dirname, '..', 'node_modules')),
      'cdk.out': out,
    });
    const assembly = await toolkit.fromAssemblyDirectory('cdk.out');
    const templateDiffs = await toolkit.diff(assembly, {
      stacks: { strategy: StackSelectionStrategy.ALL_STACKS },
      method: DiffMethod.LocalFile('cdk.out/test-stack2.template.json'),
    });
    const stackDiff = new StackDiff(
      {
        diff: templateDiffs['test-stack'],
        stackName: 'test-stack',
      },
      [],
    );

    // WHEN
    const { diff, changes } = await stackDiff.diffStack();

    // THEN
    expect(diff.isEmpty).toEqual(false);
    expect(diff.differenceCount).toEqual(1);
    expect(diff.resources.changes.MyRole.changeImpact).toEqual(
      ResourceImpact.WILL_REPLACE,
    );
    expect(changes).toEqual({
      updatedResources: 1,
      removedResources: 0,
      createdResources: 0,
      unknownEnvironment: undefined,
      destructiveChanges: [
        {
          impact: ResourceImpact.WILL_REPLACE,
          logicalId: 'MyRole',
          stackName: 'test-stack',
        },
      ],
    });
  });

  test('diff with allowed destructive changes', async () => {
    // GIVEN
    const out = cdkout;
    out['test-stack2.template.json'] = JSON.stringify({
      Resources: {
        MyRole: {
          Type: 'AWS::IAM::Role',
          Properties: {
            RoleName: 'MyCustomName2',
          },
        },
      },
    });
    mock({
      node_modules: mock.load(path.join(__dirname, '..', 'node_modules')),
      'cdk.out': out,
    });
    const assembly = await toolkit.fromAssemblyDirectory('cdk.out');
    const templateDiffs = await toolkit.diff(assembly, {
      stacks: { strategy: StackSelectionStrategy.ALL_STACKS },
      method: DiffMethod.LocalFile('cdk.out/test-stack2.template.json'),
    });
    const stackDiff = new StackDiff(
      {
        diff: templateDiffs['test-stack'],
        stackName: 'test-stack',
      },
      ['AWS::IAM::Role'],
    );

    // WHEN
    const { diff, changes } = await stackDiff.diffStack();

    // THEN
    expect(diff.isEmpty).toEqual(false);
    expect(diff.differenceCount).toEqual(1);
    expect(diff.resources.changes.MyRole.changeImpact).toEqual(
      ResourceImpact.WILL_REPLACE,
    );
    expect(changes).toEqual({
      updatedResources: 1,
      removedResources: 0,
      createdResources: 0,
      destructiveChanges: [],
    });
  });

  test('diff with code only changes', async () => {
    // GIVEN
    const out = cdkout;
    out['test-stack2.template.json'] = JSON.stringify({
      Resources: {
        MyRole: {
          Type: 'AWS::Lambda::Function',
          Properties: {
            Code: {
              S3Bucket: 'bucket',
              S3Key: 'abcdefg.zip',
            },
          },
        },
      },
    });
    out['test-stack.template.json'] = JSON.stringify({
      Resources: {
        MyRole: {
          Type: 'AWS::Lambda::Function',
          Properties: {
            Code: {
              S3Bucket: 'bucket',
              S3Key: 'abcd.zip',
            },
          },
        },
      },
    });
    mock({
      node_modules: mock.load(path.join(__dirname, '..', 'node_modules')),
      'cdk.out': out,
    });
    const assembly = await toolkit.fromAssemblyDirectory('cdk.out');
    const templateDiffs = await toolkit.diff(assembly, {
      stacks: { strategy: StackSelectionStrategy.ALL_STACKS },
      method: DiffMethod.LocalFile('cdk.out/test-stack2.template.json'),
    });
    const stackDiff = new StackDiff(
      {
        diff: templateDiffs['test-stack'],
        stackName: 'test-stack',
      },
      [],
    );

    // WHEN
    const { diff, changes } = await stackDiff.diffStack();

    // THEN
    expect(diff.isEmpty).toEqual(false);
    expect(diff.differenceCount).toEqual(1);
    expect(changes).toEqual({
      updatedResources: 0,
      removedResources: 0,
      createdResources: 0,
      destructiveChanges: [],
    });
  });

  test('diff with code & metadata only changes', async () => {
    // GIVEN
    const out = cdkout;
    out['test-stack2.template.json'] = JSON.stringify({
      Resources: {
        MyRole: {
          Type: 'AWS::Lambda::Function',
          Properties: {
            Code: {
              S3Bucket: 'bucket',
              S3Key: 'abcdefg.zip',
            },
            Metadata: {
              'aws:asset:path': '../asset.abcdefg.zip',
            },
          },
        },
      },
    });
    out['test-stack.template.json'] = JSON.stringify({
      Resources: {
        MyRole: {
          Type: 'AWS::Lambda::Function',
          Properties: {
            Code: {
              S3Bucket: 'bucket',
              S3Key: 'abcd.zip',
            },
            Metadata: {
              'aws:asset:path': '../asset.abcd.zip',
            },
          },
        },
      },
    });
    mock({
      node_modules: mock.load(path.join(__dirname, '..', 'node_modules')),
      'cdk.out': out,
    });
    const assembly = await toolkit.fromAssemblyDirectory('cdk.out');
    const templateDiffs = await toolkit.diff(assembly, {
      stacks: { strategy: StackSelectionStrategy.ALL_STACKS },
      method: DiffMethod.LocalFile('cdk.out/test-stack2.template.json'),
    });
    const stackDiff = new StackDiff(
      {
        diff: templateDiffs['test-stack'],
        stackName: 'test-stack',
      },
      [],
    );

    // WHEN
    const { diff, changes } = await stackDiff.diffStack();

    // THEN
    expect(diff.isEmpty).toEqual(false);
    expect(diff.differenceCount).toEqual(1);
    expect(changes).toEqual({
      updatedResources: 0,
      removedResources: 0,
      createdResources: 0,
      destructiveChanges: [],
    });
  });

  test('diff with cdk metadata change equals no diff', async () => {
    // GIVEN
    const out = cdkout;
    out['test-stack2.template.json'] = JSON.stringify({
      Resources: {
        MyRole: {
          Type: 'AWS::CDK::Metadata',
          Properties: {
            Analytics: 'v2:default64:abcd',
          },
        },
      },
    });
    out['test-stack.template.json'] = JSON.stringify({
      Resources: {
        MyRole: {
          Type: 'AWS::CDK::Metadata',
          Properties: {
            Analytics: 'v2:default64:abcdefg',
          },
        },
      },
    });
    mock({
      node_modules: mock.load(path.join(__dirname, '..', 'node_modules')),
      'cdk.out': out,
    });
    const assembly = await toolkit.fromAssemblyDirectory('cdk.out');
    const templateDiffs = await toolkit.diff(assembly, {
      stacks: { strategy: StackSelectionStrategy.ALL_STACKS },
      method: DiffMethod.LocalFile('cdk.out/test-stack2.template.json'),
    });
    const stackDiff = new StackDiff(
      {
        diff: templateDiffs['test-stack'],
        stackName: 'test-stack',
      },
      [],
    );

    // WHEN
    const { diff, changes } = await stackDiff.diffStack();

    // THEN
    expect(diff.isEmpty).toEqual(true);
    expect(diff.differenceCount).toEqual(0);
    expect(changes).toEqual({
      updatedResources: 0,
      removedResources: 0,
      createdResources: 0,
      destructiveChanges: [],
    });
  });
});
