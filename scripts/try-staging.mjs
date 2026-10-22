// Recoverable folder swap for the try-out loop. A journal in stagingDir records
// each step, so an interrupted run is finished or undone before anything reads
// the installed build. Only complete folders are moved; nothing is deleted
// except the superseded previous build and leftover staging copies.
import { readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'

const exists = async (target) => {
  try {
    await stat(target)
    return true
  } catch {
    return false
  }
}

export async function readIdentity(directory) {
  const manifest = JSON.parse(
    await readFile(path.join(directory, 'manifest.json'), 'utf8')
  )
  return { name: manifest.name, key: manifest.key ?? null, manifest }
}

/** Refuse a build that could change the extension or its id. */
export function checkIdentity(
  candidate,
  installed,
  { compatibleNames: names = [installed.name] } = {}
) {
  if (!names.includes(candidate.name) || !names.includes(installed.name))
    throw new Error('the candidate is not the configured extension.')
  // A reviewed display-name transition comes from the project/target metadata.
  // The key and registered install path still determine extension identity.
  if (candidate.key !== installed.key)
    throw new Error(
      'the candidate manifest key differs from the installed build; that could change the extension id.'
    )
}

const journalPath = (stagingDir) => path.join(stagingDir, 'swap.json')
const previousPath = (stagingDir) => path.join(stagingDir, 'previous')

async function writeJournal(stagingDir, value) {
  await writeFile(journalPath(stagingDir), JSON.stringify(value) + '\n')
}

/**
 * Finish or undo an interrupted swap. Returns 'none', 'restored' (the old
 * install is back) or 'completed' (the new install stays and the old one
 * becomes the rollback copy).
 */
export async function recoverStaging({ installDir, stagingDir }) {
  let journal
  try {
    journal = JSON.parse(await readFile(journalPath(stagingDir), 'utf8'))
  } catch (error) {
    if (error.code === 'ENOENT') return 'none'
    throw new Error(
      'The staging journal is unreadable; preserve it and inspect before retrying.'
    )
  }
  if (
    journal.installDir &&
    path.resolve(journal.installDir) !== path.resolve(installDir)
  )
    throw new Error(
      'The staging journal belongs to another installDir; nothing was recovered.'
    )
  for (const field of ['swap', 'candidate'])
    if (
      journal[field] &&
      (!path.isAbsolute(journal[field]) ||
        path.dirname(journal[field]) !== path.resolve(stagingDir))
    )
      throw new Error(
        'The staging journal points outside stagingDir; nothing was recovered.'
      )
  const installed = await exists(installDir)
  const swapped = journal.swap && (await exists(journal.swap))
  let outcome = 'none'
  if (!installed && swapped) {
    await rename(journal.swap, installDir)
    outcome = 'restored'
  } else if (installed && swapped) {
    await rm(previousPath(stagingDir), { recursive: true, force: true })
    await rename(journal.swap, previousPath(stagingDir))
    outcome = 'completed'
  } else if (!installed)
    throw new Error(
      `${installDir} is missing and the interrupted run left no copy to restore.`
    )
  if (
    journal.candidate &&
    journal.candidate !== previousPath(stagingDir) &&
    (await exists(journal.candidate))
  )
    await rm(journal.candidate, { recursive: true, force: true })
  await rm(journalPath(stagingDir), { force: true })
  return outcome
}

/** Install `candidate` at installDir and keep the replaced build as previous. */
export async function swapIn({
  installDir,
  stagingDir,
  candidate,
  label = Date.now(),
}) {
  const swap = path.join(stagingDir, `swap-${label}`)
  await writeJournal(stagingDir, { installDir, swap, candidate })
  await rename(installDir, swap)
  try {
    await rename(candidate, installDir)
  } catch (error) {
    await rename(swap, installDir)
    await rm(journalPath(stagingDir), { force: true })
    throw error
  }
  // A rollback moves `previous` itself into place; nothing to remove first.
  if (candidate !== previousPath(stagingDir))
    await rm(previousPath(stagingDir), { recursive: true, force: true })
  await rename(swap, previousPath(stagingDir))
  await rm(journalPath(stagingDir), { force: true })
}

export const stagingPaths = (stagingDir) => ({
  previous: previousPath(stagingDir),
  journal: journalPath(stagingDir),
})
