/**
 * Inputs to the GH Workflow
 */
export interface Inputs {
  /**
   * The GitHub TOKEN to use to create the comment
   */
  githubToken: string;

  /**
   * A list of CloudFormation resource types that are allowed
   * to be destroyed.
   *
   * @default - there are no allowed destroy types
   */
  allowedDestroyTypes: string[];

  /**
   * Whether the workflow will fail if there are any non-allowed
   * destructive changes
   *
   * @default true
   */
  failOnDestructiveChanges: boolean;

  /**
   * List of stages to ignore and not show a diff for
   *
   * @default - show diff for all stages
   */
  noDiffForStages: string[];

  /**
   * List of stages where breaking changes will not fail the build
   *
   * @default - breaking changes on any stage will fail the build
   */
  noFailOnDestructiveChanges: string[];

  /**
   * The location of the CDK output directory
   *
   * @default cdk.out
   */
  cdkOutDir: string;

  /**
   * Whether the workflow will comment for unchanged stacks
   *
   * @default - comment for unchanged stacks
   */
  ignoreUnchangedStacks: boolean;
}
