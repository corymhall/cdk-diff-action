import * as path from 'path';
import { AssemblyManifest, Manifest, ArtifactType, AwsCloudFormationStackProperties, NestedCloudAssemblyProperties, BootstrapRole } from '@aws-cdk/cloud-assembly-schema';
import * as fs from 'fs-extra';

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

  /**
   * The region the stack is deployed to
   *
   * @default - unknown-region
   */
  region?: string;

  /**
   * The lookup role to use
   *
   * @default - no lookup role
   */
  lookupRole?: BootstrapRole;

  /**
   * The JSON content of the stack
   */
  content: { [key: string]: any };
}

/**
 * Reads a Cloud Assembly manifest
 */
export class AssemblyManifestReader {
  public static readonly DEFAULT_FILENAME = 'manifest.json';

  /**
   * Reads a Cloud Assembly manifest from a file
   */
  public static fromFile(fileName: string): AssemblyManifestReader {
    try {
      const obj = Manifest.loadAssemblyManifest(fileName);
      return new AssemblyManifestReader(path.dirname(fileName), obj);

    } catch (e: any) {
      throw new Error(`Cannot read integ manifest '${fileName}': ${e.message}`);
    }
  }

  /**
   * Reads a Cloud Assembly manifest from a file or a directory
   * If the given filePath is a directory then it will look for
   * a file within the directory with the DEFAULT_FILENAME
   */
  public static fromPath(filePath: string): AssemblyManifestReader {
    let st;
    try {
      st = fs.statSync(filePath);
    } catch (e: any) {
      throw new Error(`Cannot read integ manifest at '${filePath}': ${e.message}`);
    }
    if (st.isDirectory()) {
      return AssemblyManifestReader.fromFile(path.join(filePath, AssemblyManifestReader.DEFAULT_FILENAME));
    }
    return AssemblyManifestReader.fromFile(filePath);
  }

  /**
   * The directory where the manifest was found
   */
  public readonly directory: string;

  constructor(directory: string, private readonly manifest: AssemblyManifest) {
    this.directory = directory;
  }

  /**
   * Get the stacks from the manifest
   * returns a map of artifactId to CloudFormation template
   */
  public get stacks(): StackInfo[] {
    const stacks: StackInfo[] = [];
    for (const [artifactId, artifact] of Object.entries(this.manifest.artifacts ?? {})) {
      if (artifact.type !== ArtifactType.AWS_CLOUDFORMATION_STACK) { continue; }
      const props = artifact.properties as AwsCloudFormationStackProperties;
      const template = fs.readJSONSync(path.resolve(this.directory, props.templateFile));
      const env = artifact.environment?.split(/\/\/?/);
      let region = env && env.length === 3 ? env[2] : undefined;
      if (region === 'unknown-region') {
        region = undefined;
      }
      stacks.push({
        content: template,
        region,
        lookupRole: props.lookupRole,
        name: props.stackName ?? artifactId,
      });
    }
    return stacks;
  }

  /**
   * Get the stages in the assembly
   */
  public get stages(): StageInfo[] {
    const stages: StageInfo[] = [];
    for (const [artifactId, artifact] of Object.entries(this.manifest.artifacts ?? {})) {
      if (artifact.type !== ArtifactType.NESTED_CLOUD_ASSEMBLY) { continue; }
      const props = artifact.properties as NestedCloudAssemblyProperties;
      const nestedAssembly = AssemblyManifestReader.fromPath(path.join(this.directory, props.directoryName));
      stages.push({
        name: props.displayName ?? artifactId,
        stacks: nestedAssembly.stacks,
      });
    }
    return stages;
  }
}
