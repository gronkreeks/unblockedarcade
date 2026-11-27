# Scrap Isle: design notes

A singleplayer, first-person survival game for EduArcade (`scrapisle.html`). It borrows the core loop of the
survival-crafting genre that Rust made popular (gather, craft, build, loot, recycle, fight, raid), but every name,
model, map and monument here is original.

## 1. Mechanics researched (genre reference: Rust)

| Area | How the reference game works | What Scrap Isle does |
|---|---|---|
| Gathering | Rock/tool hits on trees and ore nodes; yields scale with tool tier; a "weak spot" bonus; nodes deplete and respawn | Hit trees, stone, metal and sulfur nodes, hemp, corpses. Tool tables (rock < stone < metal < salvaged). Final-hit bonus, respawn timers, HQM chance on metal nodes |
| Smelting | Furnace burns wood (makes charcoal) and smelts ore | Furnace container with fuel, ore and output slots, real tick |
| Crafting | Blueprints, crafting queue with times, workbench level 1/2/3 gates recipes; tech tree unlocks with scrap; research table (item + scrap) | Same: known blueprints per survivor, queue with real timers, tier gates, workbench tech tree, research table |
| Building | Twig foundation on a grid, walls/doorways/floors/stairs/roofs; hammer upgrades twig > wood > stone > sheet metal > armoured; stability; tool cupboard = building privilege + upkeep; decay without upkeep | 3 m socket grid per structure, same piece set and five grades, stability propagation with collapse, Claim Cabinet for privilege + upkeep, decay |
| Doors | Wood / sheet / armoured doors, key locks, code locks | Same, code entry UI, team authorisation |
| Survival | Health, calories, hydration, temperature, bleeding, radiation, fall damage, comfort | Health, calories, hydration, temperature (biome, time, weather, clothing, fires), bleeding, radiation zones, fall damage |
| Loot | Barrels on roads, crates, food crates, military crates at monuments; components recycled into scrap and resources | Same container types and component list; recyclers at monuments, roughly half of the craft cost back |
| Combat | Projectile ballistics with drop, recoil patterns, armour by body part, durability, loot bags on death | Same, simulated per projectile |
| Raiding | Breach doors/walls with explosives, loot the cupboard and boxes | Bots compute the cheapest breach path through the socket grid, craft charges from sulfur, breach, loot, carry home |

Original names used where the reference game has its own: Claim Cabinet (tool cupboard), Pipe Pistol (single-shot
flint pistol), Drum SMG, Scrap SMG, Militia (monument guards), Roadside Fuel Stop (second fuel station).

## 2. Architecture

ES modules under `scrapisle/js/`, three.js from a CDN, no build step.

```
core/      rng, noise, util, spatial hash, event bus
data/      items, recipes, loot tables, building + deployable definitions
world/     WorldGeneration (heightmap, biomes, rivers, roads, monuments, spawn lists),
           Terrain (meshes), Monuments (meshes, colliders, loot points, recyclers, radiation), Environment (day/night, weather)
physics/   Physics (static + dynamic colliders, cylinder movement, raycasts, segment tests)
entities/  Survivor (shared by the player and every bot), Avatars (humanoid + animal meshes)
systems/   Inventory, Crafting, Building, Deployables, Resources, Loot, Recycler, Combat, Survival, Animals, NPCs
player/    PlayerController, ViewModel
bots/      BotProfiles, BotTeams, BotBrain (utility AI), BotActions (movement/gather/craft/build primitives),
           BotProgression, BotBuilder (base templates), BotRaiding (evaluation, prep, breach, loot, defence)
sim/       WorldSimulation (LOD scheduler + world ticks)
save/      SaveSystem (IndexedDB worlds, localStorage settings, autosave)
ui/        UIManager + Icons + panels (HUD, inventory, crafting, building, map, menus)
audio/     Audio (WebAudio synthesised sound effects)
```

Key rule: the player and the bots are the same `Survivor` class and call the same systems. A bot gathers by
damaging a real node, crafts by spending its real inventory through `CraftingSystem`, builds through
`BuildingSystem.place()`, and raids by putting real charges on real doors. Nothing is handed out.

## 3. How systems interact

```
Resources --gather--> Inventory --craft--> Crafting(queue) --> Inventory
Inventory --place--> Building / Deployables (privilege from Claim Cabinet)
Loot/Recycler <--> Inventory           Furnace: ore + fuel -> frags/sulfur/hqm/charcoal
Combat: weapons(items) -> projectiles -> Physics tests -> damage (Survival / Building / Animals)
Death -> loot bag container -> anyone can loot it
Bots: Brain(goal) -> Actions -> same systems; Teams share memory (known bases), stash and raid plans
WorldSimulation decides per bot: full (near), reduced (mid), abstract (far) ticks
SaveSystem serialises every system's state; world mesh regenerates from the seed
```

## 4. Roadmap (build order)

1. World, terrain, player controller, collision
2. Resources + gathering
3. Inventory + crafting
4. Building (grid, grades, stability, privilege, decay, doors, locks)
5. Loot, monuments, recyclers
6. Combat, weapons, armour, animals, militia
7. Bot profiles, teams, brain
8. Bot progression (tools > base > furnace > workbench > tiers > upgrades)
9. Raiding + defence
10. LOD world simulation
11. Saving/loading
12. UI polish, audio

## 5. Performance risks and answers

- Hundreds of bots: three LOD tiers. Near (<180 m) full AI and physics; mid (<600 m) brain at 1 Hz, simple movement,
  no mesh past 350 m; far: abstract ticks every 2 s that resolve whole actions (travel time, gather yield per
  second from the real tool and node, abstract firefights using real weapons, ammo and armour).
- Thousands of trees/nodes: InstancedMesh per type, spatial hash for queries, custom ray tests (no three.js
  raycaster on instances).
- Terrain: chunked meshes for frustum culling; heights sampled from the heightmap with bilinear filtering.
- Buildings: shared geometries/materials per piece and grade.
- Save size: world mesh is never saved, only the seed and diffs (node states, containers, structures, entities).
