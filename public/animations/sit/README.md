# SIT artwork interface

No SIT PNG artwork is included yet. The app enters a logical resting state after
60 seconds without interaction, suspends roaming, and displays the original
standing idle frame as a static fallback (`pet.png` if idle also fails). This is
not a rendered sitting pose.

Provide all four transparent PNGs here:

- `sit_01.png`: start lowering from the standing pose
- `sit_02.png`: intermediate lowering pose
- `sit_03.png`: near-seated pose
- `sit_04.png`: final seated resting pose (held until interaction)

Use the same 512 × 1408 canvas as `public/animations/idle/idle_01.png`, with the feet/bottom baseline
in the same canvas location and transparent unused space (the idle frame's visible
bottom is at row 1389, followed by 19 transparent rows). Do not crop frames to
the visible body. The renderer keeps a fixed image height and proportional width.
All four frames are required; partial or failed loads use the static fallback.

Timing and paths are configured in `src/animation-system.ts`. The transition plays
once at 4 fps, then holds the final frame. Clicking, dragging, disabling auto-sit,
or explicitly starting roaming wakes the character.
