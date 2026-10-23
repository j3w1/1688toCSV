import { readFile, realpath } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'

export function trialArguments(argv) {
  const flags = new Set()
  let configPath
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]
    if (arg === '--config') {
      configPath = argv[++index]
      if (!configPath || configPath.startsWith('--'))
        throw new Error('--config needs a file path.')
    } else if (
      ['--quick', '--smoke', '--dry-run', '--rollback', '--help'].includes(arg)
    )
      flags.add(arg)
    else throw new Error(`Unknown option ${arg}. Use --help.`)
  }
  if (flags.has('--rollback') && flags.has('--dry-run'))
    throw new Error('Choose either --rollback or --dry-run.')
  return { flags, configPath }
}

export async function readTrialConfiguration(
  root,
  { configPath, env = process.env, home = homedir() } = {}
) {
  const pkg = JSON.parse(
    await readFile(path.join(root, 'package.json'), 'utf8')
  )
  const defaults = pkg.localTrial || {}
  const slug = String(pkg.name || 'extension')
    .replace(/^@/, '')
    .replace(/[^a-zA-Z0-9._-]/g, '-')
  const configRoot =
    env.XDG_CONFIG_HOME && path.isAbsolute(env.XDG_CONFIG_HOME)
      ? env.XDG_CONFIG_HOME
      : path.join(home, '.config')
  const explicit = configPath || env.LOCAL_TRIAL_CONFIG
  const names = [slug, ...(defaults.legacyConfigNames || [])]
  if (names.some((name) => !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name)))
    throw new Error('localTrial config names must be single directory names.')
  const paths = explicit
    ? [path.resolve(root, explicit)]
    : [...new Set(names)].map((name) => path.join(configRoot, name, 'try.json'))
  for (const [index, candidate] of paths.entries()) {
    let text
    try {
      text = await readFile(candidate, 'utf8')
    } catch (error) {
      if (error.code === 'ENOENT') continue
      throw new Error(
        `Could not read trial config ${candidate}: ${error.code || 'read failed'}.`
      )
    }
    let config
    try {
      config = JSON.parse(text)
    } catch {
      throw new Error(`Trial config ${candidate} must contain valid JSON.`)
    }
    if (!config || typeof config !== 'object' || Array.isArray(config))
      throw new Error(`Trial config ${candidate} must be an object.`)
    return {
      pkg,
      defaults,
      config: { ...defaults, ...config },
      configPath: candidate,
      paths,
      legacy: !explicit && index > 0,
    }
  }
  return { pkg, defaults, config: null, configPath: null, paths, legacy: false }
}

export function within(parent, child) {
  const relative = path.relative(parent, child)
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== '..' &&
      !path.isAbsolute(relative))
  )
}

// An interrupted atomic swap may temporarily leave the install absent.
export async function canonicalDirectory(directory) {
  let current = path.resolve(directory)
  const missing = []
  for (;;) {
    try {
      return path.join(await realpath(current), ...missing)
    } catch (error) {
      if (error.code !== 'ENOENT' || path.dirname(current) === current)
        throw error
      missing.unshift(path.basename(current))
      current = path.dirname(current)
    }
  }
}

export function validateTrialConfiguration(config) {
  if (
    !path.isAbsolute(config.installDir || '') ||
    !path.isAbsolute(config.stagingDir || '')
  )
    throw new Error('Trial config needs absolute installDir and stagingDir.')
  if (!/^[a-p]{32}$/.test(config.extensionId || ''))
    throw new Error('Trial config needs the registered extensionId.')
  if (
    !Array.isArray(config.browserMcp) ||
    !config.browserMcp.length ||
    config.browserMcp.some((arg) => typeof arg !== 'string' || !arg.trim())
  )
    throw new Error(
      'Trial config needs browserMcp as a command and argument array.'
    )
  if (typeof config.databaseName !== 'string' || !config.databaseName.trim())
    throw new Error('Trial config or package localTrial needs databaseName.')
  if (
    config.compatibleNames !== undefined &&
    (!Array.isArray(config.compatibleNames) ||
      config.compatibleNames.some((name) => typeof name !== 'string' || !name))
  )
    throw new Error(
      'compatibleNames must list the reviewed extension display names.'
    )
  return config
}
