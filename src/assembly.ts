import { TemplateDiff } from '@aws-cdk/cloudformation-diff';
import { CloudAssembly } from '@aws-cdk/cx-api';

/**
 * Information on the CDK Stage
 */
export interface StageInfo {
  /**
   * The name of the stage
   */
  name: string;

  /**
   * The stacks within the stage
   */
  stacks: StackInfo[];
}

/**
 * Information on a stack
 */
export interface StackInfo {
  /**
   * The name of the stack
   */
  name: string;
}

/**
 * Reads a Cloud Assembly manifest
 */
export class AssemblyManifestReader {
  constructor(
    private readonly assembly: CloudAssembly,
    private readonly stackDiffs: { [name: string]: TemplateDiff },
  ) {}

  private inDiff(stackName: string): boolean {
    return !!this.stackDiffs[stackName];
  }

  /**
   * Get the stacks from the manifest
   * returns a map of artifactId to CloudFormation template
   */
  public get stacks(): StackInfo[] {
    const stacks: StackInfo[] = [];
    this.assembly.stacks.forEach((stack)=> {
      const stackName = stack.displayName;
      if (this.inDiff(stackName)) {
        stacks.push({
          name: stackName,
        });
      }
    });
    return stacks;
  }

  /**
   * Get the stages in the assembly
   */
  public get stages(): StageInfo[] {
    const stages: StageInfo[] = [];
    this.assembly.nestedAssemblies.forEach((nestedAssembly) => {
      const cloudAssembly = new AssemblyManifestReader(nestedAssembly.nestedAssembly, this.stackDiffs);
      const stacks = cloudAssembly.stacks;
      if (stacks.length === 0) {
        return;
      }
      stages.push({
        name: nestedAssembly.displayName ?? nestedAssembly.id,
        stacks: cloudAssembly.stacks,
      });
    });
    return stages;
  }
}
