import { ExecutorContext } from '@nx/devkit';
import { buildCommand } from '../../utils/build-command';
import { cargoCommand, cargoMetadata } from '../../utils/cargo';
import { BuildExecutorSchema } from './schema';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export default async function* runExecutor(
  options: BuildExecutorSchema,
  context: ExecutorContext
): AsyncGenerator<{ success: boolean }> {
  const { 'artifact-dir': artifactDir, ...buildOptions } = options;
  const { release, 'target-dir': targetDir, target } = buildOptions;

  const command = buildCommand('build', buildOptions, context);

  const { success: buildSuccess } = await cargoCommand(...command);

  // Handle artifact-dir option that is not supported in cargo stable yet
  let copyArtifactSuccess;
  if (buildSuccess && artifactDir) {
    const { projectName } = context;
    if (projectName !== undefined) {
      copyArtifactSuccess = await copyArtifacts(
        projectName,
        artifactDir,
        targetDir,
        release,
        target
      );
    } else {
      copyArtifactSuccess = false;
      console.error(`No 'projectName' property found in the executor context`);
    }
  }

  yield {
    success: copyArtifactSuccess ?? buildSuccess,
  };
}

/**
 * Copy the built artifacts from the target directory, managed by cargo,
 * to the artifact directory, specified by the end user.
 *
 * This emulates the behavior of the `--artifact-dir` option in cargo nightly.
 * see https://github.com/rust-lang/cargo/issues/6790
 *
 * Note: This does not handle the next cases:
 * - On Windows, the artifacts are suffixed with `.exe` extension.
 * - Binaries having a name different than the crate name.
 *
 * @param projectName - The name of the project
 * @param artifactDir - The directory to copy the artifacts to
 * @param targetDir - The directory where the artifacts are built
 * @param release - Release mode of the build. This affects the location of the built artifacts.
 * @param target - Target architecture of the build. This affects the location of the built artifacts.
 *
 * @returns true if the artifacts were successfully copied, false otherwise
 */
async function copyArtifacts(
  projectName: string,
  artifactDir: string,
  targetDir?: string,
  release?: boolean,
  target = ''
) {
  const profile = release ? 'release' : 'debug';

  // If no target is specified, use the default target retrieved from cargo metadata
  const targetDirWithDefault = targetDir ?? cargoMetadata()?.target_directory;

  if (!targetDirWithDefault) {
    return false;
  }

  try {
    // Nomrmalize paths
    const binaryPath = path.normalize(
      `${targetDirWithDefault}/${target}/${profile}/${projectName}`
    );
    const artifactPath = path.normalize(`${artifactDir}/${projectName}`);

    // Move the built artifact to the artifact directory
    await fs.mkdir(artifactDir, { recursive: true });
    await fs.copyFile(binaryPath, artifactPath);
  } catch (e) {
    console.error(
      `Failed to handle the '--artifact-dir' option correctly: ${e} `
    );
    return false;
  }

  return true;
}
