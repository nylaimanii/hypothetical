# /live: what was caught and fixed

Standing rule: everything on screen must make sense and trace back to a real reason in the sim. Each entry: what was
wrong, the cause, the fix (the cause, not the symptom).

## caught and fixed
1. a newborn walking the street alone at 1y speed: the held "story hour" fell inside a travel leg. fixed: fast speeds
   never show a mid-walk position; infants stay with the family (and now are always held by a caregiver)
2. strangers sitting at her table: the crowd's home list included her house. fixed: neighbors live in other houses
3. her mother and siblings vanished from the world once she turned 20: only people she lived with were placed.
   fixed: all living kin are in the world, in their own house; she visits them on weekends
4. narration said "kofi and halima came too" while they were out at the park: her visit was scheduled, theirs was not.
   fixed: hosts stay home for the visit, and narration names only kin who are actually in that house
5. a sister with the chosen person's own name: sibling names were drawn without checking. fixed in the generator and
   repaired in recorded lives (scripts/life-migrate.ts)
6. students in debt for years while living at home: living costs were charged to anyone without income. fixed: the
   family covers students and young people at home; shortfalls are mostly eaten, a slice becomes debt
7. "the grandchildren visited" in journals of people with no children: template ignored kin. fixed
8. teleports mid-afternoon: a month boundary could rewrite the day's plan. fixed: a day is planned from its start
9. the camera lost her at 1d and in montage cuts: the orbit camera chased a lagging target. fixed: a framing camera
   computed from her position every frame, cuts with her on jumps, snaps back if she ever leaves the frame
10. a passerby / car / lamp pole between the camera and her: fixed: anything in that line fades out of the shot
11. a crowd member standing in her work station: slot 8 wrapped to station 0. fixed: unique slots per person
12. the clock opened at 7:24pm when seeking: month boundaries are not at midnight. fixed: seeks land on a day start
13. feet sliding: legs animated by time, not distance; stride too long for the legs. fixed: distance-driven gait with
    planted stance feet (measured slip: 0.0000 units per frame)

14. a held newborn sank into the mother's chest: the baby was placed at a fixed height. fixed: the baby lies in front of
    the carrier's chest at forearm height and both arms reach under it by ik (rig.ts reachArm/cradleFor); qa checks
    hand-to-baby distance and that the baby is in front of the chest
15. houses built for 1.3 m people (doors 1.45 m, storeys 2.1 m): no shared sizes. fixed: life/components/dims.ts
    (door 2.0 m, storey 2.8 m, chair 45 cm, table 75 cm, real vehicle sizes); qa checks sizes against people
16. toes dug 5 cm into the ground at toe-off, and dragged at the start of the swing: the foot pitched about the ankle.
    fixed: toe-off rolls on the toes, the swing lifts the toe clear
17. houses inside houses: a home snapped to its real lot overlapped the house beside it. fixed: neighbors give way
18. a 4 m lane with people walking on (inside) the stoops and chats in the middle of the lane. fixed: fronts set back
    to a 6 m lane with 4.3 m clear; walkers, chats, sweeping, sitting each at their real distance from the middle
19. people walking out through the front wall, and the newborn's carrier "outdoors" inside the house: no threshold.
    fixed: inside a building's walls is inside that building (for everyone, her too)
20. two cooks at one stove, 10 people sharing 4 bench spots, 30 vendors on 4 market spots, everyone at a desk spot that
    wrapped after 8: fixed stations. fixed: real places (stove and counter, the step, a market with two stall rows and an
    aisle, a grid of spots) and a spot allocator: people take a free spot on arrival and keep it
21. 76 neighbors living in 10 houses: fixed: the crowd lives in the row houses around her (about 5 per house)
22. sitting on nothing: fixed: every sitting station has a chair, bench, stool or the step under it, at its height
23. a waiting-for-the-bus leg put people at their desk: fixed: waiting is standing at the stop
24. a 6 year old alone at the market; crowd kids under 8 walking to school alone: fixed: small children go where their
    grown-up goes (beside them out, home with them in); a grown-up with small kids keeps a caregiver's day
25. passersby skated sideways, walked through each other and through people standing, popped in mid-shot and slid along
    with her: stateless positions. fixed: stateful walkers on the ground at their own pace, keep right, keep a step
    behind, wait for vehicles, swerve around people standing, join and leave only at the ends of the street
26. vehicles: minibuses and cars in a 4 m lane, parked bajaji sliding with her, deadlocks, vehicles vanishing next to
    her. fixed: lanes carry bodas and bajaji at real size on their side of the lane, a ring queue, speed they can stop
    from, yield to anyone ahead or crossing; the daladala only when she rides it
27. talking to nobody / to two people at once: fixed: a talker turns to one person in reach and keeps them
28. walkers zig-zagging (heading snapped 0.6 rad at corners and where the lane offset kicked in): fixed: corners are
    walked as a curve, the drift to the side of the lane eases in, walkers face exactly where they step
29. cuts (documentary dips, seeks) made people walk over from where they were: fixed: a cut snaps the population and
    takes any vehicle or passerby that would stand on someone out of that shot

## enforcement
- dev: /live runs the ragdoll checks every frame (Scene.tsx RagdollQa) and logs each new violation as [ragdoll]
- npx tsx scripts/life-qa.ts: 3 sim days (newborn in dar es salaam, 6 year old in luanda, 34 year old in
  antananarivo), sampled every 10 sim minutes with a 3 s watch at 30 fps, every body, seat, held baby and vehicle,
  every frame. exits non-zero on any violation
- progress: about 1000 distinct violations and 230k violation-frames at the first run; now 237 distinct and about
  7.8k violation-frames. not zero yet, so no commit of the scene yet

## open (being rebuilt)
- the street does not look like a real street (blank walls, no color, empty): rebuilding to life/REFERENCE.md
- remaining (237): feet sliding on a few walkers (blend at stops/starts), walkers brushing at the market door at the
  luanda lunch rush, a few vehicle/person brushes at intersections, passerby fades at the window edge
