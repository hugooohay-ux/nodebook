// A large example vault: a small astronomy encyclopedia. Notes link to each other, sit under "Part of"
// parents (stored as `up:` properties) and are sorted into folders (groups), so the graph has a lot to show.
window.EXAMPLE_VAULT = (() => {
  const folders = [
    { name: 'Solar System', color: '#f76b15' },
    { name: 'Stars', color: '#e2a336' },
    { name: 'Galaxies & cosmology', color: '#8e4ec6' },
    { name: 'Physics', color: '#0090ff' },
    { name: 'Observing', color: '#12a594' },
    { name: 'Astronomers', color: '#d6409f' },
  ];
  const notes = [];
  // folder: index into `folders` (null = no folder); up: the notes this one is part of
  const N = (folder, title, up, body) => notes.push({ folder, title, up, body: body.trim() });

  // ---------- the top ----------
  N(null, 'Astronomy', [], `
The study of everything beyond Earth's atmosphere: planets, stars, galaxies and the universe as a whole.

## Start here
- [[Solar System]] — our Sun and everything orbiting it
- [[Stars]] — how they are born, live and die
- [[Galaxies]] and [[Cosmology]] — the largest scales there are
- [[Physics of the sky]] — the rules that make it all work
- [[Observing the sky]] — telescopes and space missions
- [[Astronomers]] — the people who worked it out

> Somewhere, something incredible is waiting to be known. — attributed to [[Carl Sagan]]`);

  // ---------- Solar System ----------
  const S = 0;
  N(S, 'Solar System', ['Astronomy'], `
The [[Sun]] and everything bound to it by [[Gravity]]: eight [[Planets]], their moons, and countless [[Small bodies]].
It formed about 4.6 billion years ago — see [[Formation of the Solar System]].

The Sun holds about 99.86% of the system's mass. Everything else follows [[Orbits]] described by [[Kepler's laws]].`);
  N(S, 'Sun', ['Solar System'], `
A middle-aged [[Main sequence]] star, about 4.6 billion years old. It shines by [[Nuclear fusion]],
turning about 600 million tonnes of hydrogen into helium every second.

Light from the Sun takes about 8 minutes 20 seconds to reach [[Earth]].
In roughly 5 billion years it will swell into a [[Red giant]] and end as a [[White dwarf]].`);
  N(S, 'Formation of the Solar System', ['Solar System'], `
About 4.6 billion years ago a cloud of gas and dust — a [[Nebula]] — collapsed under [[Gravity]].
Most of the material fell to the centre and became the [[Sun]]; the rest flattened into a spinning disk.

In the disk, dust stuck together into ever larger bodies. Close to the Sun only rock and metal survived,
making the [[Terrestrial planets]]; further out ice was plentiful, and the [[Gas giants]] grew big enough to
hold on to hydrogen and helium. The leftovers are the [[Small bodies]].`);
  N(S, 'Planets', ['Solar System'], `
A planet orbits the [[Sun]], is massive enough to be round, and has cleared its orbit of other bodies.
That last rule (2006) is why [[Pluto]] is now one of the [[Dwarf planets]].

- [[Terrestrial planets]]: [[Mercury]], [[Venus]], [[Earth]], [[Mars]]
- [[Gas giants]]: [[Jupiter]], [[Saturn]]
- [[Ice giants]]: [[Uranus]], [[Neptune]]

Planets around other stars are [[Exoplanets]].`);
  N(S, 'Terrestrial planets', ['Planets'], `
The four inner, rocky planets: [[Mercury]], [[Venus]], [[Earth]] and [[Mars]].
They have solid surfaces, iron cores, and few or no moons.`);
  N(S, 'Mercury', ['Terrestrial planets'], `
The smallest planet and the closest to the [[Sun]]. A year lasts 88 Earth days.
With almost no atmosphere, its surface swings from about 430 °C by day to −180 °C at night.
Its orbit shifts slightly over time — a puzzle that [[General relativity]] finally explained.`);
  N(S, 'Venus', ['Terrestrial planets'], `
Almost the same size as [[Earth]], but covered by a thick carbon dioxide atmosphere.
The runaway greenhouse effect makes it the hottest planet (about 465 °C), hotter than [[Mercury]].
It spins backwards and very slowly: a day on Venus is longer than its year.`);
  N(S, 'Earth', ['Terrestrial planets'], `
The only place known to have life. Liquid water covers about 71% of the surface,
helped by Earth sitting in the Sun's [[Habitable zone]].
It has one natural satellite, the [[Moon]]. Its distance from the [[Sun]] defines the astronomical unit (about 150 million km).`);
  N(S, 'Moon', ['Earth'], `
Earth's only natural satellite, probably formed when a Mars-sized body hit the young [[Earth]].
It always shows us the same face, and its pull causes most of the ocean tides.
Twelve people walked on it during the [[Apollo program]].`);
  N(S, 'Mars', ['Terrestrial planets'], `
The red planet: its dust is rich in iron oxide. It has the tallest volcano in the Solar System, Olympus Mons,
and a canyon, Valles Marineris, as long as the United States is wide.
Dry riverbeds show water once flowed here, which is why [[Mars rovers]] search for signs of past life.
Two small moons: [[Phobos and Deimos]].`);
  N(S, 'Phobos and Deimos', ['Mars'], `
The two tiny, potato-shaped moons of [[Mars]], possibly captured from the [[Asteroid belt]].
Phobos is slowly spiralling inwards and will break up or crash in tens of millions of years.`);
  N(S, 'Gas giants', ['Planets'], `
[[Jupiter]] and [[Saturn]]: huge planets made mostly of hydrogen and helium, with no solid surface to stand on.
Together they hold over 90% of the mass of all the [[Planets]].`);
  N(S, 'Jupiter', ['Gas giants'], `
The largest planet — more than twice as massive as all the others combined.
Its Great Red Spot is a storm bigger than [[Earth]] that has raged for at least 190 years.
[[Galileo Galilei]] discovered its four largest moons in 1610: the [[Galilean moons]].
Visited by the [[Voyager program]] and many later probes.`);
  N(S, 'Galilean moons', ['Jupiter'], `
Io, [[Europa]], Ganymede and Callisto — the four large moons of [[Jupiter]] found by [[Galileo Galilei]].
Seeing them circle another planet was strong evidence against an Earth-centred universe, supporting [[Nicolaus Copernicus]].

- Io is the most volcanic body known.
- Ganymede is the largest moon in the Solar System, bigger than [[Mercury]].
- Callisto is one of the most heavily cratered objects we know.`);
  N(S, 'Europa', ['Galilean moons'], `
An icy moon of [[Jupiter]] with a global ocean of salty liquid water under its crust.
One of the best places to look for life beyond [[Earth]].`);
  N(S, 'Saturn', ['Gas giants'], `
Famous for [[Saturn's rings]]. Saturn is less dense than water.
It has well over 100 known moons; the largest is [[Titan]].
Explored in detail by [[Cassini-Huygens]].`);
  N(S, "Saturn's rings", ['Saturn'], `
Billions of chunks of water ice, from dust grains to house-sized boulders, spread over 280,000 km but often only about 10 m thick.
They may be relatively young, and slowly raining down onto [[Saturn]].`);
  N(S, 'Titan', ['Saturn'], `
[[Saturn]]'s largest moon and the only moon with a thick atmosphere.
It has lakes and rivers — of liquid methane and ethane. The Huygens probe of [[Cassini-Huygens]] landed there in 2005.`);
  N(S, 'Ice giants', ['Planets'], `
[[Uranus]] and [[Neptune]]: smaller than the [[Gas giants]], with more water, ammonia and methane "ices" inside.
Only one spacecraft has visited them: Voyager 2 of the [[Voyager program]].`);
  N(S, 'Uranus', ['Ice giants'], `
Tipped on its side (98° tilt), probably by an ancient collision, so its poles take turns facing the [[Sun]] for 42 years each.
The first planet found with a telescope, by William Herschel in 1781.`);
  N(S, 'Neptune', ['Ice giants'], `
The farthest planet. It was predicted with mathematics before it was seen (1846), from the way it tugged on [[Uranus]] — a triumph for [[Isaac Newton]]'s [[Gravity]].
Its winds are the fastest in the Solar System. Largest moon: [[Triton]].`);
  N(S, 'Triton', ['Neptune'], `
[[Neptune]]'s largest moon orbits backwards, so it was probably captured from the [[Kuiper belt]].
Voyager 2 saw geysers of nitrogen on its frozen surface.`);
  N(S, 'Small bodies', ['Solar System'], `
Everything in the [[Solar System]] that isn't the [[Sun]], a planet or a moon:
- [[Asteroid belt]] — rocky leftovers between [[Mars]] and [[Jupiter]]
- [[Kuiper belt]] and [[Oort cloud]] — icy leftovers far out
- [[Dwarf planets]] such as [[Pluto]] and [[Ceres]]
- [[Comets]] and [[Meteors]]`);
  N(S, 'Asteroid belt', ['Small bodies'], `
A ring of rocky bodies between [[Mars]] and [[Jupiter]]. Jupiter's [[Gravity]] stopped them from forming a planet.
Despite the films, it's mostly empty: the asteroids are typically hundreds of thousands of km apart.
Its largest member is [[Ceres]].`);
  N(S, 'Ceres', ['Asteroid belt', 'Dwarf planets'], `
The largest object in the [[Asteroid belt]] and the only one of the [[Dwarf planets]] in the inner Solar System.
NASA's Dawn probe found bright salt deposits in its craters.`);
  N(S, 'Dwarf planets', ['Small bodies'], `
Round bodies orbiting the [[Sun]] that have *not* cleared their orbit (see [[Planets]]).
Best known: [[Pluto]], [[Ceres]], Eris, Haumea and Makemake.`);
  N(S, 'Pluto', ['Dwarf planets', 'Kuiper belt'], `
Found in 1930 and called the ninth planet until 2006. It lives in the [[Kuiper belt]].
[[New Horizons]] flew past in 2015 and found a heart-shaped plain of nitrogen ice, mountains of water ice, and a thin blue haze.
Its largest moon, Charon, is half its size.`);
  N(S, 'Kuiper belt', ['Small bodies'], `
A broad ring of icy bodies beyond [[Neptune]], 30–50 times as far from the [[Sun]] as [[Earth]].
Home of [[Pluto]], and source of many short-period [[Comets]].`);
  N(S, 'Oort cloud', ['Small bodies'], `
A vast, still unseen shell of icy bodies surrounding the [[Solar System]], perhaps a [[Light-year]] or more from the [[Sun]].
Long-period [[Comets]] are thought to fall in from here.`);
  N(S, 'Comets', ['Small bodies'], `
"Dirty snowballs" of ice and dust. Near the [[Sun]] the ice turns to gas, and they grow a glowing head and tails
that always point away from the Sun.
Short-period comets come from the [[Kuiper belt]], long-period ones from the [[Oort cloud]].
The most famous is [[Halley's Comet]]. Dust they leave behind gives us [[Meteors]].`);
  N(S, "Halley's Comet", ['Comets'], `
Returns every 75–76 years; last seen in 1986, next in 2061.
[[Edmond Halley]] used [[Isaac Newton]]'s laws to show that comets seen in 1531, 1607 and 1682 were the same object, and predicted its return.`);
  N(S, 'Meteors', ['Small bodies'], `
Streaks of light when bits of rock or dust burn up in [[Earth]]'s atmosphere. A piece that reaches the ground is a meteorite.
Meteor showers happen when Earth crosses the dust trail of one of the [[Comets]] — the Perseids each August come from comet Swift–Tuttle.`);

  // ---------- Stars ----------
  const T = 1;
  N(T, 'Stars', ['Astronomy'], `
Huge balls of hot gas held together by [[Gravity]] and powered by [[Nuclear fusion]] in their cores.
The nearest one is our [[Sun]]; the next nearest is [[Proxima Centauri]].

- How they live and die: [[Stellar evolution]]
- How to sort them: [[Hertzsprung-Russell diagram]]
- Stars in pairs: [[Binary stars]]
- Planets around them: [[Exoplanets]]`);
  N(T, 'Stellar evolution', ['Stars'], `
The life story of a star depends almost entirely on its mass.

1. A [[Nebula]] collapses into a [[Protostar]]
2. Fusion starts and it joins the [[Main sequence]]
3. When the core hydrogen runs out it swells into a [[Red giant]]
4. Small stars shed their outer layers and leave a [[White dwarf]]
5. Massive stars explode as a [[Supernova]], leaving a [[Neutron star]] or one of the [[Black holes]]`);
  N(T, 'Nebula', ['Stellar evolution'], `
A cloud of gas and dust in space. Some are stellar nurseries, where [[Gravity]] pulls clumps together into a [[Protostar]];
others are what's left after a star dies (a planetary nebula, or a [[Supernova]] remnant).
Famous example: the Orion Nebula, visible to the naked eye. Our own [[Formation of the Solar System]] started in one.`);
  N(T, 'Protostar', ['Stellar evolution'], `
A star still forming: a collapsing clump of a [[Nebula]] that heats up as it shrinks.
When the core reaches about 10 million °C, [[Nuclear fusion]] begins and it becomes a [[Main sequence]] star.`);
  N(T, 'Main sequence', ['Stellar evolution', 'Hertzsprung-Russell diagram'], `
The long, stable middle of a star's life, spent fusing hydrogen into helium in the core. About 90% of stars are here now, including the [[Sun]].
The heavier the star, the hotter, brighter and shorter-lived it is: a star of 10 solar masses lasts only about 20 million years,
while red dwarfs like [[Proxima Centauri]] may last trillions.`);
  N(T, 'Red giant', ['Stellar evolution'], `
What a [[Main sequence]] star becomes when the hydrogen in its core runs out: the core shrinks, the outer layers swell enormously and cool.
When the [[Sun]] becomes one, it will likely engulf [[Mercury]] and [[Venus]].`);
  N(T, 'White dwarf', ['Stellar evolution'], `
The leftover core of a star like the [[Sun]]: about as big as [[Earth]], but with half a Sun's mass — a teaspoon would weigh tonnes.
It no longer fuses anything and slowly cools over billions of years.
In [[Binary stars]] one can steal matter from its partner and explode as a type Ia [[Supernova]].`);
  N(T, 'Supernova', ['Stellar evolution'], `
A star exploding, briefly outshining a whole galaxy. It happens when a massive star's core collapses,
or when a [[White dwarf]] gains too much mass.
Supernovae spread elements like oxygen, iron and calcium through space — much of the stuff in your body was made this way.
The core left behind is a [[Neutron star]] or one of the [[Black holes]].
Type Ia supernovae always peak at about the same brightness, which revealed [[Dark energy]].`);
  N(T, 'Neutron star', ['Supernova'], `
A collapsed core about 20 km across with more mass than the [[Sun]]: the densest thing we can see directly.
Spinning ones that sweep beams across [[Earth]] are seen as a [[Pulsar]].
When two neutron stars merge they make [[Gravitational waves]] — and gold.`);
  N(T, 'Pulsar', ['Neutron star'], `
A spinning [[Neutron star]] whose radio beams sweep past [[Earth]] like a lighthouse, ticking with clock-like precision.
The first was found in 1967 by [[Jocelyn Bell Burnell]] using [[Radio telescopes]].`);
  N(T, 'Black holes', ['Supernova', 'General relativity'], `
Regions where [[Gravity]] is so strong that nothing, not even [[Light]], can escape once past the [[Event horizon]].
Stellar black holes form when the biggest stars collapse in a [[Supernova]]; supermassive ones sit in the centre of most [[Galaxies]],
like [[Sagittarius A*]] in the [[Milky Way]]. Predicted by [[General relativity]].`);
  N(T, 'Event horizon', ['Black holes'], `
The boundary of a black hole: the point of no return. For a black hole with the [[Sun]]'s mass it would be about 3 km across.
The Event Horizon Telescope photographed the shadow of one in 2019 (M87*) and of [[Sagittarius A*]] in 2022.`);
  N(T, 'Hertzsprung-Russell diagram', ['Stars'], `
A chart of [[Stars]] by temperature (or colour) against brightness. Most stars fall on a diagonal band, the [[Main sequence]];
[[Red giant]] stars sit top right and [[White dwarf]] stars bottom left.
Sorting stars by the [[Spectroscopy]] of their light was pioneered at Harvard, where [[Cecilia Payne-Gaposchkin]] worked.`);
  N(T, 'Binary stars', ['Stars'], `
Two stars orbiting each other — about half of Sun-like stars have a partner.
Measuring their [[Orbits]] is the most direct way to weigh a star. Close pairs can swap matter, which can set off a [[Supernova]].
[[Proxima Centauri]] belongs to a triple system with Alpha Centauri A and B.`);
  N(T, 'Proxima Centauri', ['Stars'], `
The nearest star to the [[Sun]], 4.24 [[Light-year]]s away. It's a small, dim red dwarf, too faint to see without a telescope.
It has at least one of the [[Exoplanets]] in its [[Habitable zone]], Proxima b.`);
  N(T, 'Exoplanets', ['Stars', 'Planets'], `
Planets orbiting other [[Stars]]. The first around a Sun-like star was found in 1995; there are now over 5,000 confirmed.
Most are found with the [[Transit method]], many by the [[Kepler space telescope]].
The big question is which ones sit in a [[Habitable zone]]. The [[James Webb Space Telescope]] can now read the chemistry of their atmospheres.`);
  N(T, 'Transit method', ['Exoplanets'], `
Watching a star's brightness for the tiny regular dip when a planet passes in front of it.
The size of the dip gives the planet's size; the time between dips gives its year.
Used by the [[Kepler space telescope]] to find thousands of [[Exoplanets]].`);
  N(T, 'Habitable zone', ['Exoplanets'], `
The range of distances from a star where a planet could have liquid water on its surface — not too hot, not too cold.
[[Earth]] is in the Sun's; [[Venus]] and [[Mars]] sit at its edges. Proxima b orbits in the habitable zone of [[Proxima Centauri]].`);

  // ---------- Galaxies & cosmology ----------
  const G = 2;
  N(G, 'Galaxies', ['Astronomy'], `
Huge systems of stars, gas, dust and [[Dark matter]] held together by [[Gravity]]. There may be around two trillion in the observable universe.
Ours is the [[Milky Way]]; the nearest big neighbour is the [[Andromeda Galaxy]]. See [[Galaxy types]].
That they are separate "island universes" was proven by [[Edwin Hubble]] in 1924.`);
  N(G, 'Galaxy types', ['Galaxies'], `
[[Edwin Hubble]] sorted galaxies by shape:
- **Spiral** — a flat disk with arms where new stars form, like the [[Milky Way]] and the [[Andromeda Galaxy]]
- **Elliptical** — smooth balls of mostly old stars, often formed when galaxies merge
- **Irregular** — no clear shape, like the Magellanic Clouds in the [[Local Group]]`);
  N(G, 'Milky Way', ['Galaxies'], `
Our home galaxy: a barred spiral about 100,000 [[Light-year]]s across, with 100–400 billion [[Stars]].
The [[Sun]] is about 26,000 light-years from the centre, where the black hole [[Sagittarius A*]] sits.
It belongs to the [[Local Group]], and will merge with the [[Andromeda Galaxy]] in about 4.5 billion years.`);
  N(G, 'Sagittarius A*', ['Milky Way', 'Black holes'], `
The supermassive black hole at the centre of the [[Milky Way]], about 4 million times the mass of the [[Sun]].
We know it's there from stars whipping around it in tight [[Orbits]] (Nobel Prize 2020); the Event Horizon Telescope imaged its shadow in 2022 — see [[Event horizon]].`);
  N(G, 'Andromeda Galaxy', ['Galaxies'], `
The nearest large galaxy, 2.5 million [[Light-year]]s away — the most distant thing you can see with the naked eye.
[[Edwin Hubble]] measured its distance using stars studied by [[Henrietta Swan Leavitt]], proving it lies far outside the [[Milky Way]].
It's heading towards us and will merge with the Milky Way.`);
  N(G, 'Local Group', ['Galaxies'], `
The small cluster of more than 80 galaxies we belong to, dominated by the [[Milky Way]] and the [[Andromeda Galaxy]], plus the Triangulum Galaxy and many dwarfs like the Magellanic Clouds.`);
  N(G, 'Cosmology', ['Astronomy'], `
The study of the universe as a whole: where it came from, what it's made of and where it's going.

- Its beginning: the [[Big Bang]]
- Its growth: [[Expansion of the universe]]
- What it's made of: about 5% ordinary matter, 27% [[Dark matter]], 68% [[Dark energy]]`);
  N(G, 'Big Bang', ['Cosmology'], `
The universe began about 13.8 billion years ago in a hot, dense state and has been expanding and cooling ever since.
It wasn't an explosion *in* space, but the expansion *of* space itself — see [[Expansion of the universe]].

Evidence: the [[Cosmic microwave background]], galaxies receding by [[Hubble's law]], and the amounts of hydrogen and helium.
The very first instant may have included [[Inflation]].`);
  N(G, 'Inflation', ['Big Bang'], `
A proposed burst of extremely fast expansion in the first tiny fraction of a second after the [[Big Bang]].
It would explain why the universe looks so even in every direction, and seeded the small ripples seen in the [[Cosmic microwave background]] that grew into [[Galaxies]].`);
  N(G, 'Cosmic microwave background', ['Big Bang'], `
The afterglow of the [[Big Bang]]: light released about 380,000 years after it, when the universe became transparent.
Stretched by the [[Expansion of the universe]], it now arrives as faint microwaves from every direction, at 2.7 degrees above absolute zero.
Found by accident in 1965 by Penzias and Wilson with a [[Radio telescopes|radio antenna]].`);
  N(G, 'Expansion of the universe', ['Cosmology'], `
Distant [[Galaxies]] are all moving away from us, and the farther they are, the faster — [[Hubble's law]].
We see it as [[Redshift]]. Since the late 1990s we know the expansion is speeding up, driven by [[Dark energy]].`);
  N(G, "Hubble's law", ['Expansion of the universe'], `
A galaxy's speed away from us is proportional to its distance. Published by [[Edwin Hubble]] in 1929 (Georges Lemaître found it two years earlier),
using distances from [[Henrietta Swan Leavitt]]'s method and speeds from [[Redshift]].
The ratio, the Hubble constant, is about 70 km/s per megaparsec — though measurements disagree slightly (the "Hubble tension").`);
  N(G, 'Dark energy', ['Expansion of the universe'], `
Whatever is making the [[Expansion of the universe]] speed up. Discovered in 1998 by measuring distant type Ia [[Supernova]] explosions,
which looked fainter — so farther away — than expected. It makes up about 68% of the universe, and nobody knows what it is.`);
  N(G, 'Dark matter', ['Cosmology', 'Galaxies'], `
Matter we can't see, detected only by its [[Gravity]]. Stars at the edges of [[Galaxies]] orbit far too fast for the visible matter alone to hold them,
as [[Vera Rubin]] showed; [[Gravitational lensing]] reveals it too.
About five times more common than ordinary matter. What it is made of is still unknown.`);

  // ---------- Physics ----------
  const P = 3;
  N(P, 'Physics of the sky', ['Astronomy'], `
The handful of ideas that explain most of what we see:
- [[Gravity]] shapes everything from [[Orbits]] to [[Galaxies]]
- [[Light]] carries almost all our information
- [[Nuclear fusion]] makes [[Stars]] shine`);
  N(P, 'Gravity', ['Physics of the sky'], `
The attraction between masses. [[Isaac Newton]] described it as a force that weakens with the square of distance;
[[Albert Einstein]] showed in [[General relativity]] that it's really the bending of space and time.
It holds [[Orbits]] together, collapses a [[Nebula]] into [[Stars]], and binds [[Galaxies]].`);
  N(P, 'Orbits', ['Gravity'], `
The path of one body around another under [[Gravity]]: always an ellipse (or circle) for bound objects, following [[Kepler's laws]].
An orbit is really falling sideways fast enough to keep missing the ground — [[Isaac Newton]]'s cannonball idea.`);
  N(P, "Kepler's laws", ['Orbits'], `
[[Johannes Kepler]]'s three laws of planetary motion (1609–1619):
1. Planets move in ellipses with the [[Sun]] at one focus
2. A line from planet to Sun sweeps equal areas in equal times — planets move faster when closer
3. The square of a planet's year is proportional to the cube of its distance

[[Isaac Newton]] later showed all three follow from his law of [[Gravity]].`);
  N(P, 'General relativity', ['Gravity'], `
[[Albert Einstein]]'s theory of [[Gravity]] (1915): mass and energy curve space and time, and things move along the curves.
It explained the orbit of [[Mercury]], and predicted [[Gravitational lensing]], [[Gravitational waves]], [[Black holes]] and the [[Expansion of the universe]].
GPS satellites must correct for it every day.`);
  N(P, 'Gravitational waves', ['General relativity'], `
Ripples in space-time from violently moving masses, like two [[Black holes]] or a pair of [[Neutron star]]s spiralling together.
Predicted by [[Albert Einstein]] in 1916 and first detected by [[LIGO]] in 2015, a hundred years later.`);
  N(P, 'Gravitational lensing', ['General relativity'], `
A massive object bends the [[Light]] passing it, like a lens. First seen during the 1919 solar eclipse, confirming [[General relativity]].
Galaxy clusters can magnify galaxies far behind them — a trick the [[James Webb Space Telescope]] uses — and the bending maps out [[Dark matter]].`);
  N(P, 'Light', ['Physics of the sky'], `
Almost everything we know about the universe arrived as light. It travels at about 300,000 km per second,
so looking far away means looking back in time — see [[Light-year]].
Visible light is a small part of the [[Electromagnetic spectrum]]; splitting it up is [[Spectroscopy]].`);
  N(P, 'Light-year', ['Light'], `
The distance [[Light]] travels in a year: about 9.46 trillion km. It's a distance, not a time.
[[Proxima Centauri]] is 4.24 light-years away; the [[Andromeda Galaxy]] 2.5 million.`);
  N(P, 'Electromagnetic spectrum', ['Light'], `
[[Light]] in all its wavelengths: radio, microwave, infrared, visible, ultraviolet, X-rays and gamma rays.
Different objects shine in different bands, so we need different telescopes: [[Radio telescopes]] for [[Pulsar]]s,
infrared for the [[James Webb Space Telescope]], microwaves for the [[Cosmic microwave background]].`);
  N(P, 'Spectroscopy', ['Light'], `
Splitting [[Light]] into its colours. Each element absorbs and emits at its own exact wavelengths — a barcode.
That lets us read what [[Stars]] are made of, how hot they are, and how fast they move (via [[Redshift]]).
[[Cecilia Payne-Gaposchkin]] used it to show stars are mostly hydrogen.`);
  N(P, 'Redshift', ['Spectroscopy'], `
When a light source moves away, its [[Light]] is stretched to longer, redder wavelengths. [[Spectroscopy]] measures the shift precisely.
The redshift of distant [[Galaxies]] is the evidence for the [[Expansion of the universe]] and [[Hubble's law]].`);
  N(P, 'Nuclear fusion', ['Physics of the sky'], `
Light atomic nuclei joining into heavier ones and releasing energy (E = mc², thanks to [[Albert Einstein]]).
In the core of the [[Sun]], hydrogen becomes helium at about 15 million °C. It powers every [[Main sequence]] star;
heavier stars fuse all the way up to iron before ending as a [[Supernova]].`);

  // ---------- Observing ----------
  const O = 4;
  N(O, 'Observing the sky', ['Astronomy'], `
How we collect [[Light]] (and more) from space:
- [[Telescopes]] on the ground and in orbit
- [[Space missions]] that go there
- [[LIGO]], which "listens" for [[Gravitational waves]]`);
  N(O, 'Telescopes', ['Observing the sky'], `
Instruments that gather far more [[Light]] than the eye. Bigger collecting area means fainter, sharper views.
- [[Optical telescopes]] — lenses and mirrors
- [[Radio telescopes]] — dishes for long wavelengths
- In space: [[Hubble Space Telescope]], [[James Webb Space Telescope]], [[Kepler space telescope]]`);
  N(O, 'Optical telescopes', ['Telescopes'], `
Refractors use lenses (like [[Galileo Galilei]]'s in 1609); reflectors use curved mirrors, an idea [[Isaac Newton]] built in 1668.
All big modern telescopes are reflectors, with mirrors up to about 10 m wide — and the Extremely Large Telescope under construction in Chile will be 39 m.`);
  N(O, 'Radio telescopes', ['Telescopes'], `
Large dishes that collect radio waves from the [[Electromagnetic spectrum]]. They found the first [[Pulsar]] and the [[Cosmic microwave background]].
Linking dishes across the planet makes a virtual Earth-sized telescope — the Event Horizon Telescope that imaged [[Sagittarius A*]].`);
  N(O, 'Hubble Space Telescope', ['Telescopes'], `
Launched in 1990, orbiting above the blurring atmosphere. Its first images were blurry from a flawed mirror, fixed by astronauts in 1993.
It helped pin down the age of the universe, found that the [[Expansion of the universe]] is speeding up ([[Dark energy]]), and took the Hubble Deep Field.
Named after [[Edwin Hubble]].`);
  N(O, 'James Webb Space Telescope', ['Telescopes'], `
Launched on Christmas Day 2021: a 6.5 m gold-coated mirror that sees in infrared, parked 1.5 million km from [[Earth]].
It sees some of the first [[Galaxies]], looks through dust into stellar nurseries in a [[Nebula]], and studies the atmospheres of [[Exoplanets]].
Successor to the [[Hubble Space Telescope]].`);
  N(O, 'Kepler space telescope', ['Telescopes', 'Space missions'], `
NASA's planet hunter (2009–2018). It stared at one patch of sky watching 150,000 stars for the [[Transit method]] dips,
and found over 2,600 [[Exoplanets]] — showing that planets are common. Named after [[Johannes Kepler]].`);
  N(O, 'Space missions', ['Observing the sky'], `
Sending instruments — and sometimes people — out there:
- [[Apollo program]] — humans on the [[Moon]]
- [[Voyager program]] — the grand tour of the outer planets
- [[Cassini-Huygens]] — 13 years at [[Saturn]]
- [[Mars rovers]] — robot geologists on [[Mars]]
- [[New Horizons]] — the first look at [[Pluto]]`);
  N(O, 'Apollo program', ['Space missions'], `
NASA's programme that landed people on the [[Moon]]. Apollo 11 touched down on 20 July 1969; six missions landed in total, the last in 1972.
Astronauts brought back 382 kg of Moon rock, which showed the Moon formed from material blasted off the young [[Earth]].`);
  N(O, 'Voyager program', ['Space missions'], `
Two probes launched in 1977. Voyager 1 visited [[Jupiter]] and [[Saturn]]; Voyager 2 also passed [[Uranus]] and [[Neptune]] — still the only visit to the [[Ice giants]].
Both have now left the Sun's bubble into interstellar space. Each carries a Golden Record, curated by a team led by [[Carl Sagan]].`);
  N(O, 'Cassini-Huygens', ['Space missions'], `
A NASA/ESA/ASI mission that orbited [[Saturn]] from 2004 to 2017. It studied [[Saturn's rings]], found water geysers on the moon Enceladus,
and dropped the Huygens probe onto [[Titan]]. It ended by diving into Saturn on purpose.`);
  N(O, 'Mars rovers', ['Space missions'], `
Robots driving on [[Mars]]: Sojourner (1997), Spirit and Opportunity (2004), Curiosity (2012), and Perseverance (2021), which is collecting rock samples
and brought along the Ingenuity helicopter. They found clear evidence that liquid water once flowed there.`);
  N(O, 'New Horizons', ['Space missions'], `
Launched in 2006, it flew past [[Pluto]] in 2015 — the first close look — and then on to Arrokoth in the [[Kuiper belt]] in 2019, the most distant object ever visited.`);
  N(O, 'LIGO', ['Observing the sky'], `
Two detectors in the USA, each with 4 km long laser arms, that measure changes in length smaller than a proton to catch [[Gravitational waves]].
First detection on 14 September 2015: two [[Black holes]] merging 1.3 billion [[Light-year]]s away. Nobel Prize 2017.`);

  // ---------- Astronomers ----------
  const A = 5;
  N(A, 'Astronomers', ['Astronomy'], `
Some of the people behind the ideas in this vault, roughly in order:
[[Nicolaus Copernicus]] → [[Galileo Galilei]] → [[Johannes Kepler]] → [[Isaac Newton]] → [[Edmond Halley]] → [[Henrietta Swan Leavitt]] →
[[Albert Einstein]] → [[Edwin Hubble]] → [[Cecilia Payne-Gaposchkin]] → [[Vera Rubin]] → [[Jocelyn Bell Burnell]] → [[Carl Sagan]]`);
  N(A, 'Nicolaus Copernicus', ['Astronomers'], `
Polish astronomer (1473–1543) who put the [[Sun]], not [[Earth]], at the centre of the [[Solar System]].
His book appeared the year he died and set off a revolution continued by [[Galileo Galilei]] and [[Johannes Kepler]].`);
  N(A, 'Galileo Galilei', ['Astronomers'], `
Italian scientist (1564–1642) and one of the first to point [[Optical telescopes]] at the sky.
He found the [[Galilean moons]] of [[Jupiter]], the phases of [[Venus]], craters on the [[Moon]], and countless stars in the [[Milky Way]].
His support for [[Nicolaus Copernicus]] got him tried by the Inquisition.`);
  N(A, 'Johannes Kepler', ['Astronomers'], `
German astronomer (1571–1630) who found [[Kepler's laws]] of planetary motion from Tycho Brahe's careful observations of [[Mars]].
He showed [[Orbits]] are ellipses, not perfect circles. The [[Kepler space telescope]] is named after him.`);
  N(A, 'Isaac Newton', ['Astronomers'], `
English physicist (1643–1727). His law of universal [[Gravity]] (1687) explained [[Kepler's laws]], the tides and the paths of [[Comets]].
He also split sunlight with a prism — early [[Spectroscopy]] — and built the first practical reflecting telescope (see [[Optical telescopes]]).`);
  N(A, 'Edmond Halley', ['Astronomers'], `
English astronomer (1656–1742) who paid to publish [[Isaac Newton]]'s great book, then used it to predict the return of [[Halley's Comet]].
He died before it came back in 1758, right on time.`);
  N(A, 'Henrietta Swan Leavitt', ['Astronomers'], `
American astronomer (1868–1921) at Harvard. She found that Cepheid variable stars pulse at a rate tied to their true brightness —
a "standard candle" for measuring cosmic distances. It let [[Edwin Hubble]] measure the [[Andromeda Galaxy]] and find [[Hubble's law]].`);
  N(A, 'Albert Einstein', ['Astronomers'], `
German-born physicist (1879–1955). Special relativity gave us E = mc², the key to [[Nuclear fusion]];
[[General relativity]] reimagined [[Gravity]] as curved space-time and predicted [[Black holes]], [[Gravitational lensing]] and [[Gravitational waves]].`);
  N(A, 'Edwin Hubble', ['Astronomers'], `
American astronomer (1889–1953). In 1924 he proved the [[Andromeda Galaxy]] lies far beyond the [[Milky Way]] — the universe is full of [[Galaxies]].
In 1929 he published [[Hubble's law]], evidence for the [[Expansion of the universe]]. He also sorted [[Galaxy types]].
The [[Hubble Space Telescope]] bears his name.`);
  N(A, 'Cecilia Payne-Gaposchkin', ['Astronomers'], `
British-American astronomer (1900–1979). Her 1925 PhD used [[Spectroscopy]] to show that [[Stars]] are made mostly of hydrogen and helium —
at the time everyone assumed they were made of the same stuff as [[Earth]]. She later became the first woman to head a department at Harvard.`);
  N(A, 'Vera Rubin', ['Astronomers'], `
American astronomer (1928–2016). Measuring how fast stars orbit in spiral [[Galaxies]], including the [[Andromeda Galaxy]], she found the outer stars move far too fast —
the strongest early evidence for [[Dark matter]]. The Vera C. Rubin Observatory is named after her.`);
  N(A, 'Jocelyn Bell Burnell', ['Astronomers'], `
Northern Irish astrophysicist (born 1943). As a PhD student in 1967 she noticed a strange regular signal in her [[Radio telescopes]] data —
the first [[Pulsar]]. The Nobel Prize for it went to her supervisor; she later gave her own 2018 Breakthrough Prize money to fund students.`);
  N(A, 'Carl Sagan', ['Astronomers'], `
American astronomer and science communicator (1934–1996), creator of the TV series *Cosmos*.
He worked on missions including the [[Voyager program]] — leading the Golden Record — and studied the greenhouse effect on [[Venus]] and the seasons of [[Mars]].
He asked Voyager 1 to turn around and photograph [[Earth]]: the "Pale Blue Dot".`);

  // ---------- assemble ----------
  const files = notes.map((n) => ({
    path: `${n.title}.md`,
    content: (n.up.length ? `---\nup:\n${n.up.map((u) => `  - "[[${u}]]"`).join('\n')}\n---\n` : '') + n.body + '\n',
  }));
  const list = folders.map((f, i) => ({ id: `ex${i}`, name: f.name, color: f.color }));
  const members = {};
  for (const n of notes) if (n.folder != null) members[`${n.title}.md`] = `ex${n.folder}`;
  return { name: 'Astronomy', notes: files, groups: { list, members } };
})();
