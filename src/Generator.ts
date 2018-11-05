import Doer from './Doer'
import { SoftwareEnvironment, SoftwarePackage } from '@stencila/schema'
import { join } from 'path'

const VERSION = require('../package').version

/**
 * Generates a Dockerfile for a `SoftwareEnvironment` instance
 */
export default class Generator extends Doer {

  /**
   * Generate a Dockerfile for a `SoftwareEnvironment` instance
   *
   * @param comments Should a comments be added to the Dockerfile?
   */
  generate (comments: boolean = true): string {
    let dockerfile = ''

    if (comments) {
      dockerfile += `# Generated by Dockter ${VERSION} at ${new Date().toISOString()}
# To stop Dockter generating this file and start editing it yourself,
# rename it to "Dockerfile".\n`
    }

    if (comments) dockerfile += '\n# This tells Docker which base image to use.\n'
    const baseIdentifier = this.baseIdentifier()
    dockerfile += `FROM ${baseIdentifier}\n`

    if (!this.applies()) return dockerfile

    const envVars = this.envVars(baseIdentifier)
    if (envVars.length) {
      if (comments) dockerfile += '\n# This section sets environment variables within the image.'
      const pairs = envVars.map(([key, value]) => `${key}="${value.replace('"', '\\"')}"`)
      dockerfile += `\nENV ${pairs.join(' \\\n    ')}\n`
    }

    const aptRepos = this.aptRepos(baseIdentifier)
    let aptKeysCommand = this.aptKeysCommand(baseIdentifier)

    if (aptRepos.length || aptKeysCommand) {
      if (comments) dockerfile += '\n# This section installs system packages needed to add extra system repositories.'
      dockerfile += `
RUN apt-get update \\
 && DEBIAN_FRONTEND=noninteractive apt-get install -y \\
      apt-transport-https \\
      ca-certificates \\
      curl \\
      software-properties-common
`
    }

    if (aptRepos.length) {
      if (comments) dockerfile += '\n# This section adds system repositories required to install extra system packages.'
      dockerfile += `\nRUN ${aptRepos.map(repo => `apt-add-repository "${repo}"`).join(' \\\n && ')}\n`
    }
    if (aptKeysCommand) {
      dockerfile += `RUN ${aptKeysCommand}\n`
    }

    let aptPackages: Array<string> = this.aptPackages(baseIdentifier)
    if (aptPackages.length) {
      if (comments) {
        dockerfile += `
# This section installs system packages required for your project
# If you need extra system packages add them here.`
      }
      dockerfile += `
RUN apt-get update \\
 && DEBIAN_FRONTEND=noninteractive apt-get install -y \\
      ${aptPackages.join(' \\\n      ')} \\
 && apt-get autoremove -y \\
 && apt-get clean \\
 && rm -rf /var/lib/apt/lists/*
`
    }

    let stencilaInstall = this.stencilaInstall(baseIdentifier)
    if (stencilaInstall) {
      if (comments) dockerfile += '\n# This section runs commands to install Stencila execution hosts.'
      dockerfile += `\nRUN ${stencilaInstall}\n`
    }

    // Once everything that needs root permissions is installed, switch the user to non-root for installing the rest of the packages.
    if (comments) {
      dockerfile += `
# It's good practice to run Docker images as a non-root user.
# This section creates a new user, sets it as the user for the image, and it's
# home directory as the working directory.`
    }
    dockerfile += `
RUN useradd --create-home --uid 1001 -s /bin/bash dockteruser
USER dockteruser
WORKDIR /home/dockteruser
`

    const installFiles = this.installFiles(baseIdentifier)
    const installCommand = this.installCommand(baseIdentifier)
    const projectFiles = this.projectFiles(baseIdentifier)
    const runCommand = this.runCommand(baseIdentifier)

    // Add Dockter special comment for managed installation of language packages
    if (installCommand) {
      if (comments) dockerfile += '\n# This is a special comment to tell Dockter to manage the build from here on'
      dockerfile += `\n# dockter\n`
    }

    // Copy files needed for installation of language packages
    if (installFiles.length) {
      if (comments) dockerfile += '\n# This section copies package requirement files into the image'
      dockerfile += '\n' + installFiles.map(([src, dest]) => `COPY ${src} ${dest}`).join('\n') + '\n'
    }

    // Run command to install packages
    if (installCommand) {
      if (comments) dockerfile += '\n# This section runs commands to install the packages specified in the requirement file/s'
      dockerfile += `\nRUN ${installCommand}\n`
    }

    // Copy files needed to run project
    if (projectFiles.length) {
      if (comments) dockerfile += '\n# This section copies your project\'s files into the image'
      dockerfile += '\n' + projectFiles.map(([src, dest]) => `COPY ${src} ${dest}`).join('\n') + '\n'
    }

    // Add any CMD
    if (runCommand) {
      if (comments) dockerfile += '\n# This tells Docker the default command to run when the container is started'
      dockerfile += `\nCMD ${runCommand}\n`
    }

    // Write `.Dockerfile` for use by Docker
    this.write('.Dockerfile', dockerfile)

    return dockerfile
  }

  // Methods that are overridden in derived classes

  applies (): boolean {
    return false
  }

  baseName (): string {
    return 'ubuntu'
  }

  baseVersion (): string {
    return '18.04'
  }

  baseVersionName (baseIdentifier: string): string {
    let [name, version] = baseIdentifier.split(':')
    const lookup: { [key: string]: string } = {
      '14.04': 'trusty',
      '16.04': 'xenial',
      '18.04': 'bionic'
    }
    return lookup[version]
  }

  baseIdentifier (): string {
    const joiner = this.baseVersion() === '' ? '' : ':'

    return `${this.baseName()}${joiner}${this.baseVersion()}`
  }

  envVars (sysVersion: string): Array<[string, string]> {
    return []
  }

  /**
   * The Bash command to run to install apt keys
   *
   * @param sysVersion The Ubuntu system version being used
   */
  aptKeysCommand (sysVersion: string): string | undefined {
    return
  }

  aptRepos (sysVersion: string): Array<string> {
    return []
  }

  aptPackages (sysVersion: string): Array<string> {
    return []
  }

  /**
   * The Bash command to run to install Stencila execution host package/s
   *
   * @param sysVersion The Ubuntu system version being used
   */
  stencilaInstall (sysVersion: string): string | undefined {
    return
  }

  /**
   * A list of files that need to be be copied
   * into the image before running `installCommand`
   *
   * @param sysVersion The Ubuntu system version being used
   * @returns An array of [src, dest] tuples
   */
  installFiles (sysVersion: string): Array<[string, string]> {
    return []
  }

  /**
   * The Bash command to run to install required language packages
   *
   * @param sysVersion The Ubuntu system version being used
   */
  installCommand (sysVersion: string): string | undefined {
    return
  }

  /**
   * The project's files that should be copied across to the image
   *
   * @param sysVersion The Ubuntu system version being used
   * @returns An array of [src, dest] tuples
   */
  projectFiles (sysVersion: string): Array<[string, string]> {
    return []
  }

  /**
   * The default command to run containers created from this image
   *
   * @param sysVersion The Ubuntu system version being used
   */
  runCommand (sysVersion: string): string | undefined {
    return
  }
}
