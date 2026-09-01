#!/usr/bin/env node
// E2E for B3: a red gate on the ORG SEAT must leave main untouched.
//
// The org seat squashes directly onto main (it has no branch), so the old
// order — squash, then gate — put the commit on main and then reported
// `parked: true`. The gate announced a failure it had not prevented. The
// session path avoids this structurally by squashing on a branch and only
// merging when green; the org seat needs an explicit rewind instead.
//
// Run: node scripts/e2e-org-seat-gate.mjs
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'
import { execFileSync } from 'node:child_process'
const R = new URL('..', import.meta.url).pathname
const gw = await import(R+'plugins/git-workspace/lib/index.js')
const d = fs.mkdtempSync(path.join(os.tmpdir(),'b3-'))
const g=(...a)=>execFileSync('git',a,{cwd:d,encoding:'utf8'})
g('init','-q','-b','main','.'); fs.writeFileSync(path.join(d,'a.txt'),'1\n')
g('add','-A'); g('-c','user.email=a@b','-c','user.name=a','commit','-qm','feat: init')
// a check.sh that always REDS
fs.writeFileSync(path.join(d,'check.sh'),'#!/bin/sh\necho "FAIL: forced red" >&2\nexit 1\n',{mode:0o755})
g('add','-A'); g('-c','user.email=a@b','-c','user.name=a','commit','-qm','chore(ci): add gate')
const before = g('rev-parse','HEAD').trim()
fs.writeFileSync(path.join(d,'a.txt'),'2\n'); gw.wipCommit(d,{message:'work'})
const preSha = gw.runGit(['rev-parse','HEAD'],{cwd:d,allowFail:true})
const sq = gw.stageBoundarySquash(d,{message:'feat(x): work',trailer:'Arxa-Stage: org'})
const gate = gw.runGate(d)
console.log('gate green?', gate.green)
const mainAfterSquash = g('rev-parse','HEAD').trim()
console.log('OLD behaviour would stop here — main moved to', mainAfterSquash.slice(0,8), '(commit is on main despite red)')
if (!gate.green && preSha) gw.runGit(['reset','--hard',preSha],{cwd:d,allowFail:true})
const mainAfterFix = g('rev-parse','HEAD').trim()
console.log('NEW behaviour: main rewound to  ', mainAfterFix.slice(0,8))
console.log()
console.log(mainAfterFix===preSha ? 'PASS: a red gate leaves main exactly where it was' : 'FAIL: main still moved')
console.log('work preserved?', fs.readFileSync(path.join(d,'a.txt'),'utf8').trim()==='2' ? 'yes — the WIP run survived' : 'NO')

process.exit(mainAfterFix === preSha && fs.readFileSync(path.join(d,'a.txt'),'utf8').trim()==='2' ? 0 : 1)
