import { SoftwareEnvironment, SoftwarePackage } from '@stencila/schema'
import path from 'path'

import Generator from './Generator'

/**
 * A Dockerfile generator for R environments
 */
export default class RGenerator extends Generator {

  date: string

  constructor (environ: SoftwareEnvironment, folder?: string) {
    super(environ, folder)

    // Default to yesterday's date (to ensure MRAN is available for the date)
    // Set here as it is required in two methods below
    let date = this.environ.datePublished
    if (!date) date = (new Date(Date.now() - 24 * 3600 * 1000)).toISOString().substring(0,10)
    this.date = date
  }

  // Methods that override those in `Generator`.
  // See that class for documentation on what each function does

  appliesRuntime (): string {
    return 'R'
  }

  baseVersion (): string {
    // At time of writing, MRAN did not have an ubuntu:18.04(bionic) repo which supported R 3.4 (only bionic_3.5)
    // See https://cran.microsoft.com/snapshot/2018-10-05/bin/linux/ubuntu/
    // So require ubuntu:16.04(xenial).
    return '16.04'
  }

  envVars (sysVersion: string): Array<[string, string]> {
    return [
      // Set the timezone to avoid warning from Sys.timezone()
      // See https://github.com/rocker-org/rocker-versioned/issues/89
      ['TZ', 'Etc/UTC'],
      // Set the location to install R packages since they will be installed
      // into the image by a non-root user.
      // See https://stat.ethz.ch/R-manual/R-devel/library/base/html/libPaths.html
      ['R_LIBS_USER', '~/R']
    ]
  }

  aptKeysCommand (sysVersion: string): string {
    return 'apt-key adv --keyserver keyserver.ubuntu.com --recv-keys 51716619E084DAB9'
  }

  aptRepos (base: string): Array<string> {
    return [
      `deb https://mran.microsoft.com/snapshot/${this.date}/bin/linux/ubuntu ${this.baseVersionName(base)}/`
    ]
  }

  aptPackages (sysVersion: string): Array<string> {
    // Walk through R packages and find any deb packages
    let debpkgs: Array<string> = []

    function find (pkg: any) {
      if (pkg.runtimePlatform !== 'R' || !pkg.softwareRequirements) return
      for (let subpkg of pkg.softwareRequirements) {
        if (subpkg.runtimePlatform === 'deb') {
          debpkgs.push(subpkg.name || '')
        } else {
          find(subpkg)
        }
      }
    }

    for (let pkg of this.environ.softwareRequirements || []) find(pkg)

    return debpkgs.concat([
      'r-base'
    ])
  }

  stencilaInstall (sysVersion: string): string | undefined {
    return `apt-get update \\
 && apt-get install -y  zlib1g-dev libxml2-dev pkg-config \\
 && apt-get autoremove -y \\
 && apt-get clean \\
 && rm -rf /var/lib/apt/lists/* \\
 && Rscript -e 'install.packages("devtools")' \\
 && Rscript -e 'source("https://bioconductor.org/biocLite.R"); biocLite("graph")' \\
 && Rscript -e 'devtools::install_github("r-lib/pkgbuild")' \\
 && Rscript -e 'devtools::install_github("stencila/r")'`
  }

  installFiles (sysVersion: string): Array<[string, string]> {
    // Copy user defined files if they exist
    if (this.exists('install.R')) return [['install.R', 'install.R']]
    if (this.exists('DESCRIPTION')) return [['DESCRIPTION', 'DESCRIPTION']]

    // Generate a .DESCRIPTION with valid name to copy into image
    const name = (this.environ.name || 'unnamed').replace(/[^a-zA-Z0-9]/,'')
    const pkgs = this.filterPackages('R').map(pkg => pkg.name)
    let desc = `Package: ${name}
Version: 1.0.0
Date: ${this.date}
Imports:\n  ${pkgs.join(',\n  ')}
Description: Generated by Dockter ${new Date().toISOString()}.
  To stop Dockter generating this file and start editing it yourself, rename it to "DESCRIPTION".\n`
    this.write('.DESCRIPTION', desc)
    return [['.DESCRIPTION', 'DESCRIPTION']]
  }

  installCommand (sysVersion: string): string | undefined {
    let cmd = 'mkdir ~/R'
    if (this.exists('install.R')) {
      // Run the user supplied installation script
      cmd += ` \\\n && Rscript install.R`
    } else if (this.exists('DESCRIPTION') || this.exists('.DESCRIPTION')) {
      // To keep the Dockerfile as simple as possible, download and
      // execute the installation-from-DESCRIPTION script.
      cmd += ` \\\n && bash -c "Rscript <(curl -sL https://unpkg.com/@stencila/dockter/src/install.R)"`
    }
    return cmd
  }

  /**
   * The files to copy into the Docker image
   *
   * Copies all `*.R` files to the container
   */
  projectFiles (): Array<[string, string]> {
    const rfiles = this.glob('**/*.R')
    return rfiles.map(file => [file, file]) as Array<[string, string]>
  }

  /**
   * The command to execute in a container created from the Docker image
   *
   * If there is a top-level `main.R` or `cmd.R` then that will be used,
   * otherwise, the first `*.R` files by alphabetical order will be used.
   */
  runCommand (): string | undefined {
    const rfiles = this.glob('**/*.R')
    if (rfiles.length === 0) return
    let script
    if (rfiles.includes('main.R')) script = 'main.R'
    else if (rfiles.includes('cmd.R')) script = 'cmd.R'
    else script = rfiles[0]
    return `Rscript ${script}`
  }
}
