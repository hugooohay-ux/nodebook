// A small, clean example vault: the Solar System.
// - Every note is "Part of" one parent (an `up:` property): a one-way link pointing up the chain, so hovering
//   shows clean paths like Solar System → Planets → Outer planets → Saturn → Titan. Parents don't link back
//   (their sub-notes are listed for them automatically).
// - A few plain one-way "see also" links close small triangles between neighbours, nothing more.
// - Three folders colour the branches.
window.EXAMPLE_VAULT = (() => {
  const folders = [
    { name: 'Inner planets', color: '#f76b15' },
    { name: 'Outer planets', color: '#0090ff' },
    { name: 'Small bodies', color: '#12a594' },
  ];
  const notes = [];
  // folder: index into `folders` (null = no folder); up: the note this one is part of
  const N = (folder, title, up, body) => notes.push({ folder, title, up, body: body.trim() });

  N(null, 'Solar System', null, `
The Sun and everything held in orbit around it, formed about 4.6 billion years ago from a collapsing cloud of gas and dust.

Hover a note in the graph to follow its path up to here, or down to everything under it.`);
  N(null, 'Sun', 'Solar System', `
A middle-aged star holding 99.86% of the Solar System's mass. Its gravity keeps all the [[Planets]] in orbit.
Sunlight takes about 8 minutes to reach Earth.`);
  N(null, 'Planets', 'Solar System', `
Eight bodies big enough to be round and to have cleared their orbits: four rocky ones close in, four giants further out.`);
  N(null, 'Small bodies', 'Solar System', `
Everything orbiting the Sun that isn't a planet or a moon: rocky and icy leftovers from when the planets formed.`);

  // ---------- inner planets ----------
  const I = 0;
  N(I, 'Inner planets', 'Planets', `
The four small, rocky planets closest to the Sun, with solid surfaces and iron cores.`);
  N(I, 'Mercury', 'Inner planets', `
The smallest planet and the closest to the Sun. A year lasts 88 days; with no real atmosphere,
it swings from 430 °C by day to −180 °C at night.`);
  N(I, 'Venus', 'Inner planets', `
Almost the same size as [[Earth]], but wrapped in thick carbon dioxide clouds that make it the hottest planet (about 465 °C).
It spins backwards, and a day there is longer than its year.`);
  N(I, 'Earth', 'Inner planets', `
The only place known to have life, with liquid water covering 71% of its surface.`);
  N(I, 'Moon', 'Earth', `
Earth's only natural satellite, probably formed from debris when a Mars-sized body hit the young Earth.
It always shows the same face, and its pull drives most of the tides.`);
  N(I, 'Mars', 'Inner planets', `
The red planet, coloured by rusty dust. It has the tallest volcano in the Solar System, Olympus Mons,
and dry riverbeds that show water once flowed there.`);
  N(I, 'Moons of Mars', 'Mars', `
Phobos and Deimos: two tiny, potato-shaped moons, possibly captured asteroids.
Phobos is slowly spiralling inwards.`);

  // ---------- outer planets ----------
  const O = 1;
  N(O, 'Outer planets', 'Planets', `
The four giants beyond the asteroid belt: two gas giants and two ice giants, each with rings and many moons.`);
  N(O, 'Jupiter', 'Outer planets', `
The largest planet, more than twice as massive as all the others together.
Its Great Red Spot is a storm wider than Earth that has lasted for centuries.`);
  N(O, 'Europa', 'Jupiter', `
An icy moon of Jupiter with a salty ocean under its crust — one of the best places to look for life.`);
  N(O, 'Saturn', 'Outer planets', `
The second-largest planet after [[Jupiter]], and light enough to float in water.`);
  N(O, "Saturn's rings", 'Saturn', `
Billions of pieces of water ice spread over 280,000 km, yet often only about 10 m thick.`);
  N(O, 'Titan', 'Saturn', `
Saturn's largest moon and the only moon with a thick atmosphere. It has lakes and rivers of liquid methane.`);
  N(O, 'Uranus', 'Outer planets', `
An ice giant tipped on its side, so each pole gets 42 years of sunlight followed by 42 years of darkness.`);
  N(O, 'Neptune', 'Outer planets', `
The farthest planet, with the fastest winds in the Solar System. Like [[Uranus]], an ice giant.
It was found in 1846 by mathematics before anyone saw it.`);
  N(O, 'Triton', 'Neptune', `
Neptune's largest moon orbits backwards, so it was probably captured. Geysers of nitrogen erupt from its frozen surface.`);

  // ---------- small bodies ----------
  const B = 2;
  N(B, 'Asteroid belt', 'Small bodies', `
A ring of rocky bodies between Mars and Jupiter. Jupiter's gravity kept them from forming a planet,
and they're far apart: typically hundreds of thousands of km.`);
  N(B, 'Ceres', 'Asteroid belt', `
The largest object in the asteroid belt and a dwarf planet, with bright salt deposits in its craters.`);
  N(B, 'Kuiper belt', 'Small bodies', `
A broad ring of icy bodies beyond Neptune, 30–50 times as far from the Sun as Earth.`);
  N(B, 'Pluto', 'Kuiper belt', `
Called the ninth planet until 2006, now a dwarf planet. New Horizons flew past in 2015 and found a heart-shaped plain of nitrogen ice.`);
  N(B, 'Comets', 'Small bodies', `
Balls of ice and dust that grow glowing tails near the Sun. Short-period comets come from the [[Kuiper belt]].`);
  N(B, "Halley's Comet", 'Comets', `
Returns every 75–76 years: last seen in 1986, next in 2061.`);

  const files = notes.map((n) => ({
    path: `${n.title}.md`,
    content: (n.up ? `---\nup:\n  - "[[${n.up}]]"\n---\n` : '') + n.body + '\n',
  }));
  const list = folders.map((f, i) => ({ id: `ex${i}`, name: f.name, color: f.color }));
  const members = {};
  for (const n of notes) if (n.folder != null) members[`${n.title}.md`] = `ex${n.folder}`;
  return { name: 'Solar System', notes: files, groups: { list, members } };
})();
