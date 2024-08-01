import { ResourceImpact } from '@aws-cdk/cloudformation-diff';
import { CloudFormationClient, GetTemplateCommand } from '@aws-sdk/client-cloudformation';
import { STSClient, GetCallerIdentityCommand } from '@aws-sdk/client-sts';
import { FromTemporaryCredentialsOptions } from '@aws-sdk/credential-providers';
import { mockClient } from 'aws-sdk-client-mock';
import { StackInfo } from '../src/assembly';
import { StackDiff } from '../src/diff';

// NOTE: if you ever get a type issue here it's because
// the version of the `@aws-sdk/*` packages are out of sync
let cfnMock = mockClient(CloudFormationClient);
let stsMock = mockClient(STSClient);

let fromTemporaryCredentialsMock = jest.fn();
jest.mock('@aws-sdk/credential-providers', () => ({
  fromTemporaryCredentials: (options) => fromTemporaryCredentialsMock(options),
}));

beforeEach(() => {
  stsMock.on(GetCallerIdentityCommand).resolves({
    Account: '123456789012',
  });
});

afterEach(() => {
  stsMock.reset();
  cfnMock.reset();
  fromTemporaryCredentialsMock.mockClear();
});

describe('StackDiff', () => {
  const env = {
    region: 'us-east-1',
    account: '123456789012',
  };
  const stackInfo: StackInfo = {
    name: 'my-stack',
    region: 'us-east-1',
    account: '123456789012',
    content: {
      Resources: {
        MyRole: {
          Type: 'AWS::IAM::Role',
          Properties: {
            RoleName: 'MyCustomName',
          },
        },
      },
    },
  };
  beforeEach(() => {
    cfnMock.on(GetTemplateCommand)
      .resolves({
        TemplateBody: JSON.stringify(stackInfo.content),
      });
  });

  test('no template diff', async () => {
    // GIVEN
    const stackDiff = new StackDiff(stackInfo, []);

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

  test('unknown environment when account is unknown', async () => {
    // GIVEN
    const info = stackInfo;
    info.account = undefined;
    const stackDiff = new StackDiff({
      ...info,
    }, []);

    // WHEN
    const { diff, changes } = await stackDiff.diffStack();

    // THEN
    expect(diff.isEmpty).toEqual(true);
    expect(changes).toEqual({
      updatedResources: 0,
      removedResources: 0,
      createdResources: 0,
      destructiveChanges: [],
      unknownEnvironment: 'aws://123456789012/us-east-1',
    });
  });

  test('AssumeRole ARN for us-east-1', async () => {
    // GIVEN
    const info = stackInfo;
    info.lookupRole = {
      arn: 'arn:${AWS::Partition}:iam::123456789012:role/cdk-abcdefgh-lookup-role-123456789012-us-east-1',
    };

    const stackDiff = new StackDiff({
      ...info,
    }, []);

    fromTemporaryCredentialsMock.mockResolvedValue({ foo: 'doesnt_matter' });

    // WHEN
    await stackDiff.diffStack();

    // THEN
    expect(fromTemporaryCredentialsMock).toHaveBeenCalledWith({
      params: {
        DurationSeconds: 900,
        ExternalId: undefined,
        RoleSessionName: 'cdk-diff-action',
        RoleArn: 'arn:aws:iam::123456789012:role/cdk-abcdefgh-lookup-role-123456789012-us-east-1',
      },
    });
  });

  test('AssumeRole ARN for us-gov-west-1', async () => {
    // GIVEN
    const info = stackInfo;
    info.region = 'us-gov-west-1';
    info.lookupRole = {
      arn: 'arn:${AWS::Partition}:iam::123456789012:role/cdk-abcdefgh-lookup-role-123456789012-us-gov-west-1',
    };

    const stackDiff = new StackDiff({
      ...info,
    }, []);

    fromTemporaryCredentialsMock.mockResolvedValue({ foo: 'doesnt_matter' });

    // WHEN
    await stackDiff.diffStack();

    // THEN
    expect(fromTemporaryCredentialsMock).toHaveBeenCalledWith({
      params: {
        DurationSeconds: 900,
        ExternalId: undefined,
        RoleSessionName: 'cdk-diff-action',
        RoleArn: 'arn:aws-us-gov:iam::123456789012:role/cdk-abcdefgh-lookup-role-123456789012-us-gov-west-1',
      },
    });
  });

  test('throws when environments do not match', async () => {
    // GIVEN
    const info = stackInfo;
    info.account = '000000000000';
    const stackDiff = new StackDiff({
      ...info,
    }, []);

    // THEN
    await expect(stackDiff.diffStack()).rejects.toThrow(/Credentials are for account 123456789012 but stack is in account 000000000000/);
  });

  test('diff with changes', async () => {
    // GIVEN
    const stackDiff = new StackDiff({
      name: 'my-stack',
      ...env,
      content: {
        Resources: {
          MyRole2: {
            Type: 'AWS::IAM::Role',
            Properties: {
              RoleName: 'MyCustomName',
              Description: 'New Description',
            },
          },
        },
      },
    }, []);

    // WHEN
    const { diff, changes } = await stackDiff.diffStack();

    // THEN
    expect(diff.isEmpty).toEqual(false);
    expect(changes).toEqual({
      updatedResources: 0,
      removedResources: 1,
      createdResources: 1,
      unknownEnvironment: undefined,
      destructiveChanges: [{
        impact: ResourceImpact.WILL_DESTROY,
        logicalId: 'MyRole',
        stackName: 'my-stack',
      }],
    });
  });

  test('diff with no destructive changes', async () => {
    // GIVEN
    const stackDiff = new StackDiff({
      name: 'my-stack',
      ...env,
      content: {
        Resources: {
          MyRole: {
            Type: 'AWS::IAM::Role',
            Properties: {
              RoleName: 'MyCustomName',
              Description: 'New Description',
            },
          },
        },
      },
    }, []);

    // WHEN
    const { diff, changes } = await stackDiff.diffStack();

    // THEN
    expect(diff.isEmpty).toEqual(false);
    expect(diff.differenceCount).toEqual(1);
    expect(diff.resources.changes.MyRole.changeImpact).toEqual(ResourceImpact.WILL_UPDATE);
    expect(changes).toEqual({
      updatedResources: 1,
      removedResources: 0,
      createdResources: 0,
      destructiveChanges: [],
      unknownEnvironment: undefined,
    });
  });

  test('diff with destructive changes', async () => {
    // GIVEN
    const stackDiff = new StackDiff({
      name: 'my-stack',
      ...env,
      content: {
        Resources: {
          MyRole: {
            Type: 'AWS::IAM::Role',
            Properties: {
              RoleName: 'MyNewCustomName',
            },
          },
        },
      },
    }, []);

    // WHEN
    const { diff, changes } = await stackDiff.diffStack();

    // THEN
    expect(diff.isEmpty).toEqual(false);
    expect(diff.differenceCount).toEqual(1);
    expect(diff.resources.changes.MyRole.changeImpact).toEqual(ResourceImpact.WILL_REPLACE);
    expect(changes).toEqual({
      updatedResources: 1,
      removedResources: 0,
      createdResources: 0,
      unknownEnvironment: undefined,
      destructiveChanges: [{
        impact: ResourceImpact.WILL_REPLACE,
        logicalId: 'MyRole',
        stackName: 'my-stack',
      }],
    });
  });

  test('diff with allowed destructive changes', async () => {
    // GIVEN
    const stackDiff = new StackDiff({
      name: 'my-stack',
      ...env,
      content: {
        Resources: {
          MyRole: {
            Type: 'AWS::IAM::Role',
            Properties: {
              RoleName: 'MyNewCustomName',
            },
          },
        },
      },
    }, ['AWS::IAM::Role']);

    // WHEN
    const { diff, changes } = await stackDiff.diffStack();

    // THEN
    expect(diff.isEmpty).toEqual(false);
    expect(diff.differenceCount).toEqual(1);
    expect(diff.resources.changes.MyRole.changeImpact).toEqual(ResourceImpact.WILL_REPLACE);
    expect(changes).toEqual({
      updatedResources: 1,
      removedResources: 0,
      unknownEnvironment: undefined,
      createdResources: 0,
      destructiveChanges: [],
    });
  });

  test('diff with code only changes', async () => {
    // GIVEN
    cfnMock.on(GetTemplateCommand)
      .resolves({
        TemplateBody: JSON.stringify({
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

        }),
      });
    const stackDiff = new StackDiff({
      name: 'my-stack',
      ...env,
      content: {
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
      },
    }, []);

    // WHEN
    const { diff, changes } = await stackDiff.diffStack();

    // THEN
    expect(diff.isEmpty).toEqual(false);
    expect(diff.differenceCount).toEqual(1);
    expect(changes).toEqual({
      updatedResources: 0,
      removedResources: 0,
      createdResources: 0,
      unknownEnvironment: undefined,
      destructiveChanges: [],
    });
  });

  test('diff with code & metadata only changes', async () => {
    // GIVEN
    cfnMock.on(GetTemplateCommand)
      .resolves({
        TemplateBody: JSON.stringify({
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

        }),
      });
    const stackDiff = new StackDiff({
      name: 'my-stack',
      ...env,
      content: {
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
      },
    }, []);

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
      unknownEnvironment: undefined,
    });
  });

  test('diff with cdk metadata change equals no diff', async () => {
    // GIVEN
    cfnMock.on(GetTemplateCommand)
      .resolves({
        TemplateBody: JSON.stringify({
          Resources: {
            MyRole: {
              Type: 'AWS::CDK::Metadata',
              Properties: {
                Analytics: 'v2:default64:abcd',
              },
            },
          },

        }),
      });
    const stackDiff = new StackDiff({
      name: 'my-stack',
      ...env,
      content: {
        Resources: {
          MyRole: {
            Type: 'AWS::CDK::Metadata',
            Properties: {
              Analytics: 'v2:default64:abcdefg',
            },
          },
        },
      },
    }, []);

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
      unknownEnvironment: undefined,
    });
  });
});
