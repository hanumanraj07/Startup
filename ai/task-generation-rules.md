# AI Development Rules

How to work in this repository. This exists because the common failure mode of AI-assisted development is not writing bad code, it is writing code that quietly contradicts decisions already made.

## Before implementing anything

1. Read `ai/project-context.md` and confirm the change respects the invariants.
2. Read `ai/memory.md` to see what has already been decided and rejected.
3. Read the specific `docs/` file that governs this area. Do not infer product rules from existing code.
4. Check `docs/17-mvp-scope.md`. If the feature is not in scope, say so instead of building it.
5. Inspect the existing code in the affected module. Reuse what is there.
6. Identify every module the change touches, including migrations, types, validation and tests.

## While implementing

- Make the smallest change that fully accomplishes the task.
- Do not modify unrelated code. Improvements you notice elsewhere get written down, not applied silently.
- Do not rename, restructure or "clean up" files you were not asked to change.
- Do not add dependencies without a reason worth stating. Check whether one already in the tree does the job.
- Follow the existing patterns in the module. Consistency beats personal preference.
- If a spec is wrong or ambiguous, stop and raise it. Do not resolve the ambiguity silently in code, because that decision then becomes invisible.

## After implementing

1. Run the tests. Fix what breaks, including tests you did not expect to touch.
2. Run the type check and the linter.
3. Update the relevant `docs/` file if behaviour changed.
4. Add an entry to `ai/memory.md` if an architectural decision was made.
5. Update `TODO.md` and `CHANGELOG.md`.

## Things that must never happen silently

If a change requires any of the following, stop and raise it explicitly:

- A change to the task state machine
- A change to how money is calculated, held or released
- A new field exposed across the requester and worker boundary
- A relaxation of an authorization check
- A schema change that drops or repurposes a column
- A new third-party service
- Anything that widens the launch scope beyond remote inspection and verification in Ahmedabad and Kolkata

## Reporting

Report what was actually done. If tests fail, say so and show the output. If part of a task was skipped or blocked, say which part and why. Do not describe work as complete when it is partial. An honest partial result is useful; a confident wrong one costs hours.
