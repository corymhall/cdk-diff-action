import * as fs from 'fs';
import path from 'path';
import * as core from '@actions/core';
import {
  DifferenceCollection,
  ResourceDifference,
  ResourceImpact,
  TemplateDiff,
} from '@aws-cdk/cloudformation-diff';
import { Toolkit, DiffMethod } from '@aws-cdk/toolkit-lib';
// eslint-disable-next-line import/no-extraneous-dependencies
import { RequestError } from '@octokit/request-error';
import type {
  RequestError as OctokitError,
  OctokitResponse,
} from '@octokit/types';
import mock from 'mock-fs';
import { FakeIoHost } from './util';
import { Comments } from '../src/comment';
import { AssemblyProcessor } from '../src/stage-processor';
jest.spyOn(core, 'debug').mockImplementation(() => {});

const toolkit = new Toolkit({
  ioHost: new FakeIoHost(),
});

let findPreviousMock = jest.fn();
let updateCommentMock = jest.fn();
let createCommentMock = jest.fn();
jest.mock('../src/comment', () => {
  return {
    Comments: jest.fn().mockImplementation(() => {
      return {
        findPrevious: findPreviousMock,
        updateComment: updateCommentMock,
        createComment: createCommentMock,
      };
    }),
  };
});

const cdkout = {
  'manifest.json': JSON.stringify({
    version: '36.0.0',
    artifacts: {
      'assembly-SomeStage': {
        type: 'cdk:cloud-assembly',
        properties: {
          directoryName: 'assembly-SomeStage',
          displayName: 'SomeStage',
        },
      },
    },
  }),
  ['assembly-SomeStage']: {
    ['manifest.json']: JSON.stringify({
      version: '36.0.0',
      artifacts: {
        'SomeStage-test-stack': {
          type: 'aws:cloudformation:stack',
          environment: 'aws://unknown-account/unknown-region',
          properties: {
            templateFile: 'SomeStage-test-stack.template.json',
            validateOnSynth: false,
            stackName: 'SomeStage-test-stack',
          },
          displayName: 'SomeStage/test-stack',
        },
      },
    }),
    ['SomeStage-test-stack.template.json']: JSON.stringify({
      Resources: {
        MyRole: {
          Type: 'AWS::IAM::Role',
          Properties: {
            RoleName: 'MyCustomName',
          },
        },
      },
    }),
  },
};

let mockOutDir: any;

beforeEach(() => {
  mockOutDir = cdkout;
});

afterEach(() => {
  mock.restore();
  findPreviousMock.mockClear();
  updateCommentMock.mockClear();
  createCommentMock.mockClear();
});

describe('StageProcessor', () => {
  test('stage with no diffs', async () => {
    mockOutDir['SomeStage-test-stack.template.json'] = JSON.stringify({
      Resources: {
        MyRole: {
          Type: 'AWS::IAM::Role',
          Properties: {
            RoleName: 'MyCustomName',
          },
        },
      },
    });
    mock({
      'cdk.out': mockOutDir,
      node_modules: mock.load(path.join(__dirname, '..', 'node_modules')),
    });
    const processor = new AssemblyProcessor({
      defaultStageDisplayName: 'DefaultStage',
      toolkit,
      allowedDestroyTypes: [],
      cdkOutDir: 'cdk.out',
      diffMethod: DiffMethod.LocalFile(
        'cdk.out/SomeStage-test-stack.template.json',
      ),
      failOnDestructiveChanges: true,
      stackSelectorPatterns: [],
      stackSelectionStrategy: 'all-stacks',
      noFailOnDestructiveChanges: [],
    });
    await processor.processStages();
    const p = processor.stageComments;
    expect(p).toEqual({
      SomeStage: expect.any(Object),
    });
    expect(p.SomeStage.stackComments['SomeStage/test-stack']).toEqual([
      'No Changes for stack: SomeStage/test-stack :white_check_mark:',
    ]);
  });

  test('stage with diff', async () => {
    mockOutDir['SomeStage-test-stack.template.json'] = JSON.stringify({
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
      'cdk.out': mockOutDir,
      node_modules: mock.load(path.join(__dirname, '..', 'node_modules')),
    });
    const processor = new AssemblyProcessor({
      defaultStageDisplayName: 'DefaultStage',
      toolkit,
      allowedDestroyTypes: [],
      cdkOutDir: 'cdk.out',
      diffMethod: DiffMethod.LocalFile(
        'cdk.out/SomeStage-test-stack.template.json',
      ),
      failOnDestructiveChanges: true,
      stackSelectorPatterns: [],
      stackSelectionStrategy: 'all-stacks',
      noFailOnDestructiveChanges: [],
    });
    await processor.processStages();
    const p = (processor as any).stageComments;
    expect(p).toEqual({
      SomeStage: expect.any(Object),
    });
    expect(
      p.SomeStage.stackComments['SomeStage/test-stack'].length,
    ).not.toEqual(0);
    expect(p.SomeStage.destructiveChanges).toEqual(1);
  });

  test('stage with destructive changes-ignored', async () => {
    mockOutDir['SomeStage-test-stack.template.json'] = JSON.stringify({
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
      'cdk.out': mockOutDir,
      node_modules: mock.load(path.join(__dirname, '..', 'node_modules')),
    });
    const processor = new AssemblyProcessor({
      defaultStageDisplayName: 'DefaultStage',
      toolkit,
      allowedDestroyTypes: [],
      cdkOutDir: 'cdk.out',
      diffMethod: DiffMethod.LocalFile(
        'cdk.out/SomeStage-test-stack.template.json',
      ),
      failOnDestructiveChanges: true,
      stackSelectorPatterns: [],
      stackSelectionStrategy: 'all-stacks',
      noFailOnDestructiveChanges: [],
    });
    await processor.processStages(['SomeStage']);
    const p = (processor as any).stageComments;
    expect(p).toEqual({
      SomeStage: expect.any(Object),
    });
    expect(
      p.SomeStage.stackComments['SomeStage/test-stack'].length,
    ).not.toEqual(0);
    expect(p.SomeStage.destructiveChanges).toEqual(0);
  });

  test('new comment created', async () => {
    mockOutDir['SomeStage-test-stack.template.json'] = JSON.stringify({
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
      'cdk.out': mockOutDir,
      node_modules: mock.load(path.join(__dirname, '..', 'node_modules')),
    });
    const processor = new AssemblyProcessor({
      defaultStageDisplayName: 'DefaultStage',
      toolkit,
      allowedDestroyTypes: [],
      cdkOutDir: 'cdk.out',
      diffMethod: DiffMethod.LocalFile(
        'cdk.out/SomeStage-test-stack.template.json',
      ),
      failOnDestructiveChanges: true,
      stackSelectorPatterns: [],
      stackSelectionStrategy: 'all-stacks',
      noFailOnDestructiveChanges: [],
    });
    await processor.processStages(['SomeStage']);
    await processor.commentStages(new Comments({} as any, {} as any));
    expect(createCommentMock).toHaveBeenCalledTimes(1);
    expect(findPreviousMock).toHaveBeenCalledTimes(1);
    expect(updateCommentMock).toHaveBeenCalledTimes(0);
  });

  test('comment updated', async () => {
    mockOutDir['SomeStage-test-stack.template.json'] = JSON.stringify({
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
      'cdk.out': mockOutDir,
      node_modules: mock.load(path.join(__dirname, '..', 'node_modules')),
    });
    const processor = new AssemblyProcessor({
      defaultStageDisplayName: 'DefaultStage',
      toolkit,
      allowedDestroyTypes: [],
      cdkOutDir: 'cdk.out',
      diffMethod: DiffMethod.LocalFile(
        'cdk.out/SomeStage-test-stack.template.json',
      ),
      failOnDestructiveChanges: true,
      stackSelectorPatterns: [],
      stackSelectionStrategy: 'all-stacks',
      noFailOnDestructiveChanges: [],
    });
    findPreviousMock.mockResolvedValue(1);
    await processor.processStages(['SomeStage']);
    await processor.commentStages(new Comments({} as any, {} as any));
    expect(findPreviousMock).toHaveBeenCalledTimes(1);
    expect(createCommentMock).toHaveBeenCalledTimes(0);
    expect(updateCommentMock).toHaveBeenCalledTimes(1);
  });

  test('filter stages', async () => {
    mockOutDir = {
      'SomeStage-test-stack.template.json': JSON.stringify({
        Resources: {
          MyRole: {
            Type: 'AWS::IAM::Role',
            Properties: {
              RoleName: 'MyCustomName2',
            },
          },
        },
      }),
      'manifest.json': JSON.stringify({
        version: '36.0.0',
        artifacts: {
          'assembly-SomeOtherStage': {
            type: 'cdk:cloud-assembly',
            properties: {
              directoryName: 'assembly-SomeOtherStage',
              displayName: 'SomeOtherStage',
            },
          },
          'assembly-SomeStage': {
            type: 'cdk:cloud-assembly',
            properties: {
              directoryName: 'assembly-SomeStage',
              displayName: 'SomeStage',
            },
          },
        },
      }),
      ['assembly-SomeOtherStage']: {
        ['manifest.json']: JSON.stringify({
          version: '36.0.0',
          artifacts: {
            'SomeOtherStage-test-stack': {
              type: 'aws:cloudformation:stack',
              environment: 'aws://unknown-account/unknown-region',
              properties: {
                templateFile: 'SomeOtherStage-test-stack.template.json',
                validateOnSynth: false,
                stackName: 'SomeOtherStage-test-stack',
              },
              displayName: 'SomeOtherStage/test-stack',
            },
          },
        }),
        ['SomeOtherStage-test-stack.template.json']: JSON.stringify({
          Resources: {
            MyRole: {
              Type: 'AWS::IAM::Role',
              Properties: {
                RoleName: 'MyCustomName',
              },
            },
          },
        }),
      },
      ['assembly-SomeStage']: {
        ['manifest.json']: JSON.stringify({
          version: '36.0.0',
          artifacts: {
            'SomeStage-test-stack': {
              type: 'aws:cloudformation:stack',
              environment: 'aws://unknown-account/unknown-region',
              properties: {
                templateFile: 'SomeStage-test-stack.template.json',
                validateOnSynth: false,
                stackName: 'SomeStage-test-stack',
              },
              displayName: 'SomeStage/test-stack',
            },
          },
        }),
        ['SomeStage-test-stack.template.json']: JSON.stringify({
          Resources: {
            MyRole: {
              Type: 'AWS::IAM::Role',
              Properties: {
                RoleName: 'MyCustomName',
              },
            },
          },
        }),
      },
    };
    mock({
      'cdk.out': mockOutDir,
      node_modules: mock.load(path.join(__dirname, '..', 'node_modules')),
    });
    const processor = new AssemblyProcessor({
      defaultStageDisplayName: 'DefaultStage',
      toolkit,
      allowedDestroyTypes: [],
      cdkOutDir: 'cdk.out',
      diffMethod: DiffMethod.LocalFile(
        'cdk.out/SomeStage-test-stack.template.json',
      ),
      failOnDestructiveChanges: true,
      stackSelectorPatterns: ['!SomeOtherStage/*'],
      stackSelectionStrategy: 'pattern-must-match',
      noFailOnDestructiveChanges: [],
    });
    await processor.processStages();
    const p = (processor as any).stageComments;
    expect(p).toEqual({
      SomeStage: expect.any(Object),
    });
    expect(
      p.SomeStage.stackComments['SomeStage/test-stack'].length,
    ).not.toEqual(0);
    expect(p.SomeStage.stackComments['SomeOtherStage/test-stack']).toEqual(
      undefined,
    );
    expect(p.SomeStage.destructiveChanges).toEqual(1);
  });
});

describe('default stage', () => {
  beforeEach(() => {
    mockOutDir = {
      'manifest.json': JSON.stringify({
        version: '36.0.0',
        artifacts: {
          'test-stack': {
            type: 'aws:cloudformation:stack',
            environment: 'aws://unknown-account/unknown-region',
            properties: {
              templateFile: 'test-stack.template.json',
              validateOnSynth: false,
              stackName: 'test-stack',
            },
            displayName: 'test-stack',
          },
        },
      }),
      ['test-stack.template.json']: JSON.stringify({
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

    mockOutDir['SomeStage-test-stack.template.json'] = JSON.stringify({
      Resources: {
        MyRole: {
          Type: 'AWS::IAM::Role',
          Properties: {
            RoleName: 'MyCustomName',
          },
        },
      },
    });
  });

  test('with defaults', async () => {
    mock({
      'cdk.out': mockOutDir,
      node_modules: mock.load(path.join(__dirname, '..', 'node_modules')),
    });
    const processor = new AssemblyProcessor({
      defaultStageDisplayName: 'DefaultStage',
      toolkit,
      allowedDestroyTypes: [],
      cdkOutDir: 'cdk.out',
      diffMethod: DiffMethod.LocalFile(
        'cdk.out/SomeStage-test-stack.template.json',
      ),
      failOnDestructiveChanges: true,
      stackSelectorPatterns: [],
      stackSelectionStrategy: 'all-stacks',
      noFailOnDestructiveChanges: [],
    });
    await processor.processStages();
    const p = (processor as any).stageComments;
    expect(p).toEqual({
      DefaultStage: expect.any(Object),
    });
    expect(p.DefaultStage.stackComments['test-stack']).toEqual([
      'No Changes for stack: test-stack :white_check_mark:',
    ]);
  });

  test('with custom', async () => {
    mock({
      'cdk.out': mockOutDir,
      node_modules: mock.load(path.join(__dirname, '..', 'node_modules')),
    });
    const processor = new AssemblyProcessor({
      defaultStageDisplayName: 'MyStage',
      title: 'Diff for MyStage',
      toolkit,
      allowedDestroyTypes: [],
      cdkOutDir: 'cdk.out',
      diffMethod: DiffMethod.LocalFile(
        'cdk.out/SomeStage-test-stack.template.json',
      ),
      failOnDestructiveChanges: true,
      stackSelectorPatterns: [],
      stackSelectionStrategy: 'all-stacks',
      noFailOnDestructiveChanges: [],
    });
    await processor.processStages();
    const p = processor.stageComments;
    expect(p).toEqual({
      MyStage: expect.any(Object),
    });
    expect(p.MyStage.title).toEqual('Diff for MyStage');
    expect(p.MyStage.stackComments['test-stack']).toEqual([
      'No Changes for stack: test-stack :white_check_mark:',
    ]);
  });
});

function setupCommentTest(): AssemblyProcessor {
  const manifestJson = {
    version: '36.0.0',
    artifacts: {},
  };

  const stacks = createStacks(10);
  stacks.forEach((stack) => {
    mockOutDir['assembly-SomeStage'][`SomeStage-${stack.name}.template.json`] =
      JSON.stringify(stack.content);
    manifestJson.artifacts[`SomeStage-${stack.name}`] = {
      type: 'aws:cloudformation:stack',
      environment: 'aws://1234567891012/us-east-1',
      properties: {
        templateFile: `${stack.name}.template.json`,
        validateOnSynth: false,
        stackName: `SomeStage-${stack.name}`,
      },
      displayName: `SomeStage/${stack.name}`,
    };
  });
  mockOutDir['assembly-SomeStage']['manifest.json'] =
    JSON.stringify(manifestJson);
  const diffInfo: { [stackName: string]: DiffInfo } = {};
  stacks.forEach((stack) => {
    diffInfo[`SomeStage/${stack.name}`] = {
      oldValue: 'MyCustomName',
      newValue: 'NewCustomName',
    };
  });
  const templateDiff = createTemplateDiffs(diffInfo);
  mock({
    'cdk.out': mockOutDir,
    node_modules: mock.load(path.join(__dirname, '..', 'node_modules')),
  });
  jest.spyOn(Toolkit.prototype, 'diff').mockResolvedValue(templateDiff);
  return new AssemblyProcessor({
    defaultStageDisplayName: 'DefaultStage',
    toolkit,
    allowedDestroyTypes: [],
    cdkOutDir: 'cdk.out',
    diffMethod: DiffMethod.TemplateOnly(),
    failOnDestructiveChanges: true,
    stackSelectorPatterns: [],
    stackSelectionStrategy: 'all-stacks',
    noFailOnDestructiveChanges: [],
  });
}
describe('stack comments', () => {
  test('stack level comments', async () => {
    findPreviousMock.mockResolvedValue(1);
    updateCommentMock.mockRejectedValueOnce(requestError(422));
    const processor = setupCommentTest();
    await processor.processStages(['SomeStage']);
    await processor.commentStages(new Comments({} as any, {} as any));
    expect(findPreviousMock).toHaveBeenCalledTimes(11);
    expect(createCommentMock).toHaveBeenCalledTimes(0);
    expect(updateCommentMock).toHaveBeenCalledTimes(11);
  });

  test('stage comment fails', async () => {
    findPreviousMock.mockResolvedValue(1);
    updateCommentMock.mockRejectedValueOnce(
      requestError(400, 'Some other error failed'),
    );
    const processor = setupCommentTest();
    await processor.processStages(['SomeStage']);
    await expect(
      processor.commentStages(new Comments({} as any, {} as any)),
    ).rejects.toThrow(/Validation Error/);
    expect(findPreviousMock).toHaveBeenCalledTimes(1);
    expect(createCommentMock).toHaveBeenCalledTimes(0);
    expect(updateCommentMock).toHaveBeenCalledTimes(1);
  });

  test('stack comment fails', async () => {
    findPreviousMock.mockResolvedValue(1);
    updateCommentMock.mockRejectedValueOnce(requestError(422));
    updateCommentMock.mockRejectedValue(
      requestError(400, 'Some other error failed'),
    );
    const processor = setupCommentTest();
    await processor.processStages(['SomeStage']);
    await expect(
      processor.commentStages(new Comments({} as any, {} as any)),
    ).rejects.toThrow(/Validation Error/);
    expect(findPreviousMock).toHaveBeenCalledTimes(11);
    expect(createCommentMock).toHaveBeenCalledTimes(0);
    expect(updateCommentMock).toHaveBeenCalledTimes(11);
  });

  test('stack comment fails too long', async () => {
    findPreviousMock.mockResolvedValue(1);
    updateCommentMock.mockRejectedValueOnce(requestError(422));
    updateCommentMock.mockRejectedValueOnce(requestError(422));
    updateCommentMock.mockRejectedValueOnce(requestError(422));
    const processor = setupCommentTest();
    await processor.processStages(['SomeStage']);
    await expect(
      processor.commentStages(new Comments({} as any, {} as any)),
    ).rejects.toThrow(/Comment for stack SomeStage\/my-stack1 is too long/);
    expect(findPreviousMock).toHaveBeenCalledTimes(11);
    expect(createCommentMock).toHaveBeenCalledTimes(0);
    expect(updateCommentMock).toHaveBeenCalledTimes(11);
  });
});

function requestError(status: number, msg?: string): RequestError {
  const message = msg ?? 'Body is too long (maximum is 65536 characters)';
  const response: OctokitResponse<OctokitError, number> = {
    headers: {},
    status,
    url: '',
    data: {
      documentation_url: '',
      name: '',
      status,
      errors: [
        {
          code: 'unprocessable',
          field: 'data',
          resource: 'IssueComment',
          message,
        },
      ],
    },
  };
  return new RequestError('Validation Error', status, {
    request: {
      url: 'https://github.com',
      headers: {
        authorization: '1234567891201010',
      },
      method: 'POST',
    },
    response: response,
  });
}

interface DiffInfo {
  oldValue: string;
  newValue: string;
}

function createTemplateDiffs(stacks: { [name: string]: DiffInfo }): {
  [name: string]: TemplateDiff;
} {
  const templateDiff: { [name: string]: TemplateDiff } = {};
  for (const [stackName, diffInfo] of Object.entries(stacks)) {
    const isreplace = diffInfo.oldValue !== diffInfo.newValue;
    templateDiff[stackName] = new TemplateDiff({
      resources: new DifferenceCollection({
        MyRole: new ResourceDifference(
          {
            Type: 'AWS::IAM::Role',
            Properties: { RoleName: diffInfo.oldValue },
          },
          {
            Type: 'AWS::IAM::Role',
            Properties: { RoleName: diffInfo.newValue },
          },
          {
            resourceType: {
              newType: 'AWS::IAM::Role',
              oldType: 'AWS::IAM::Role',
            },
            otherDiffs: {},
            propertyDiffs: {
              RoleName: {
                isUpdate: isreplace,
                isAddition: false,
                isDifferent: isreplace,
                isRemoval: false,
                newValue: diffInfo.newValue,
                oldValue: diffInfo.oldValue,
                changeImpact: isreplace
                  ? ResourceImpact.WILL_REPLACE
                  : ResourceImpact.NO_CHANGE,
              },
            },
          },
        ),
      }),
    });
  }
  return templateDiff;
}

function createStacks(numStacks: number): any[] {
  const stacks: any[] = [];
  for (let i = 0; i < numStacks; i++) {
    stacks.push({
      name: `my-stack${i}`,
      content: {
        Resources: {
          MyRole: {
            Type: 'AWS::IAM::Role',
            Properties: {
              RoleName: 'MyNewCustomName2',
              Property1: 'SomeText',
            },
          },
        },
      },
    });
  }
  return stacks;
}
