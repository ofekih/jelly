import { boardGamePrice, newPrice, usedPrice } from '../src/gamePrice';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  bestPlayers,
  bggCandidates,
  nameScore,
  resetIgdbToken,
  searchBoardGames,
  searchVideoGames,
  toBoardGame,
  toVideoGame,
} from '../src/games';

const thing = (id: number, name: string, extra = '', type = 'boardgame', usersrated = 100) => `
  <item type="${type}" id="${id}">
    <thumbnail>https://cf.geekdo-images.com/${id}.jpg</thumbnail>
    <name type="primary" sortindex="1" value="${name}"/>
    <name type="alternate" sortindex="1" value="${name} (alt)"/>
    <yearpublished value="2019"/>
    <minplayers value="1"/><maxplayers value="5"/>
    <poll-summary name="suggested_numplayers" title="User Suggested Number of Players">
      <result name="bestwith" value="Best with 3 players"/>
      <result name="recommmendedwith" value="Recommended with 1–4 players"/>
    </poll-summary>
    <minplaytime value="40"/><maxplaytime value="70"/>
    <link type="boardgamecategory" id="1002" value="Card Game"/>
    <link type="boardgamemechanic" id="2023" value="Cooperative Game"/>
    <link type="boardgamedesigner" id="1" value="Elizabeth Hargrave"/>
    ${extra}
    <statistics page="1"><ratings>
      <usersrated value="${usersrated}"/>
      <ranks><rank type="subtype" id="1" name="boardgame" friendlyname="Board Game Rank" value="30"/>
      <rank type="family" id="5497" name="strategygames" friendlyname="Strategy Game Rank" value="20"/></ranks>
      <averageweight value="2.4798"/>
    </ratings></statistics>
  </item>`;
const page = (items: string) => `<?xml version="1.0" encoding="utf-8"?><items>${items}</items>`;
const parse = (x: string) => {
  // Reuse the module's parser through the public search function's shape
  const { XMLParser } = require('fast-xml-parser');
  const p = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '',
    isArray: (n: string, _p: string, _l: boolean, attr: boolean) => !attr && ['item', 'name', 'link', 'rank', 'result', 'poll-summary'].includes(n),
  });
  return p.parse(x).items.item[0];
};

describe('board games (BGG)', () => {
  it('maps a thing: players, best count, time, complexity, designer and tags', () => {
    expect(toBoardGame(parse(page(thing(266192, 'Wingspan'))))).toEqual({
      placeId: 'bgg:266192',
      title: 'Wingspan',
      year: 2019,
      cover: 'https://cf.geekdo-images.com/266192.jpg',
      creator: 'Elizabeth Hargrave',
      tags: ['Strategy', 'Card Game', 'Co-op'],
      players: [1, 5],
      best: [3, 3],
      time: [40, 70],
      weight: 2.5,
      ratings: 100,
    });
  });

  it('skips expansions, including fan expansions listed as games', () => {
    expect(toBoardGame(parse(page(thing(1, 'Seafarers', '', 'boardgameexpansion'))))).toBeNull();
    expect(
      toBoardGame(parse(page(thing(2, 'Fan Pack', '<link type="boardgamecategory" id="1042" value="Expansion for Base-game"/>'))))
    ).toBeNull();
  });

  it('reads best player counts, or none when undetermined', () => {
    expect(bestPlayers('Best with 3–4 players')).toEqual([3, 4]);
    expect(bestPlayers('Best with 6, 8 players')).toEqual([6, 8]);
    expect(bestPlayers('(Undetermined)')).toBeUndefined();
  });

  it('looks up the closest names first', () => {
    const search = page(`
      <item type="boardgame" id="5"><name type="primary" value="Cataclysm"/></item>
      <item type="boardgame" id="9"><name type="primary" value="Catan"/></item>
      <item type="boardgame" id="7"><name type="primary" value="Catan Junior"/></item>`);
    expect(bggCandidates(search, 'catan')).toEqual(['9', '7', '5']);
  });

  it('sorts results by popularity and name, in at most two detail lookups', async () => {
    const calls: string[] = [];
    const fetchFn = async (url: string, init?: { headers?: Record<string, string> }) => {
      calls.push(url);
      expect(init?.headers?.Authorization).toBe('Bearer t');
      const body = url.includes('/search?')
        ? page(Array.from({ length: 45 }, (_, i) => `<item type="boardgame" id="${i + 1}"><name type="primary" value="Wing ${i}"/></item>`).join(''))
        : page(thing(1, 'Wing Obscure', '', 'boardgame', 3) + thing(2, 'Wing Famous', '', 'boardgame', 50000));
      return { ok: true, status: 200, json: async () => ({}), text: async () => body };
    };
    const games = await searchBoardGames('wing', 't', fetchFn);
    // (Both fake pages return the same two games)
    expect(games.map((g) => g.title)).toEqual(['Wing Famous', 'Wing Famous', 'Wing Obscure', 'Wing Obscure']);
    expect(games[0]).not.toHaveProperty('ratings');
    expect(calls.filter((u) => u.includes('/thing?'))).toHaveLength(2);
    expect(calls.find((u) => u.includes('/thing?'))!.split('id=')[1].split('&')[0].split(',')).toHaveLength(20);
  });
});

describe('video games (IGDB)', () => {
  beforeEach(() => resetIgdbToken());

  it('maps a game: year, cover, developers and tags', () => {
    expect(
      toVideoGame({
        id: 113112,
        name: 'Hades',
        first_release_date: 1600300800,
        cover: { image_id: 'co39vc' },
        genres: [{ name: 'Role-playing (RPG)' }, { name: 'Indie' }],
        game_modes: [{ name: 'Single player' }],
        involved_companies: [
          { developer: true, company: { name: 'Supergiant Games' } },
          { developer: false, company: { name: 'Publisher' } },
        ],
        total_rating_count: 1792,
      })
    ).toEqual({
      placeId: 'igdb:113112',
      title: 'Hades',
      year: 2020,
      cover: 'https://images.igdb.com/igdb/image/upload/t_cover_big/co39vc.jpg',
      creator: 'Supergiant Games',
      tags: ['RPG', 'Indie'],
      ratings: 1792,
    });
    expect(toVideoGame({ id: 1 })).toBeNull();
  });

  it('merges text search with a name-contains query, signs in once, and ranks by popularity', async () => {
    const bodies: string[] = [];
    let tokens = 0;
    const fetchFn = async (url: string, init?: { body?: string }) => {
      if (url.includes('id.twitch.tv')) {
        tokens += 1;
        return { ok: true, status: 200, json: async () => ({ access_token: 'tok', expires_in: 5000000 }), text: async () => '' };
      }
      bodies.push(init!.body!);
      const results = init!.body!.startsWith('search')
        ? [{ id: 1, name: 'Zelda II', total_rating_count: 300 }]
        : [{ id: 2, name: 'The Legend of Zelda: Breath of the Wild', total_rating_count: 3000 }, { id: 1, name: 'Zelda II', total_rating_count: 300 }];
      return { ok: true, status: 200, json: async () => results, text: async () => '' };
    };
    const games = await searchVideoGames('zelda', 'id', 'secret', fetchFn);
    expect(games.map((g) => g.placeId)).toEqual(['igdb:2', 'igdb:1']);
    await searchVideoGames('zelda', 'id', 'secret', fetchFn);
    expect(tokens).toBe(1);
    expect(bodies.every((b) => b.includes('game_type = (0,4,8,9,10)') && b.includes('version_parent = null'))).toBe(true);
  });

  it('scores names: exact over prefix over contains', () => {
    expect([nameScore('Hades', 'hades'), nameScore('Hades II', 'hades'), nameScore('Into Hades', 'hades'), nameScore('X', 'hades')]).toEqual([3, 2, 1, 0]);
  });
});

describe('board game price', () => {
  const listing = (price: number, extra: object = {}) => ({ price: String(price), currency: 'USD', productstate: 'active', ...extra });
  const ad = { us: { newPriceWithoutSymbol: '39.99', newPriceCurrency: 'USD' } };

  it('takes the new price from the Amazon ad, none when there is no ad', () => {
    expect(newPrice(ad)).toEqual({ amount: 39.99, currency: 'USD' });
    expect(newPrice([])).toBeUndefined();
    expect(newPrice({ us: { newPriceWithoutSymbol: '0', newPriceCurrency: 'USD' } })).toBeUndefined();
  });

  it('uses the middle half of active dollar listings and needs a few', () => {
    const products = [10, 15, 20, 25, 100, 5].map((p) => listing(p));
    products.push(listing(900, { currency: 'EUR' }), listing(1, { productstate: 'sold' }));
    expect(usedPrice({ products })).toEqual({ low: 11, high: 24, count: 6, currency: 'USD' });
    expect(usedPrice({ products: [listing(10), listing(20)] })).toBeUndefined();
  });

  it('combines both, keeps one when the other fails, throws when both do', async () => {
    const products = [10, 20, 30].map((p) => listing(p));
    const respond = (urls: Record<string, any>) => async (url: string) => {
      const hit = Object.keys(urls).find((k) => url.includes(k))!;
      return urls[hit] instanceof Error
        ? { ok: false, status: 500, json: async () => ({}) }
        : { ok: true, status: 200, json: async () => urls[hit] };
    };
    expect(await boardGamePrice('13', respond({ 'amazon/': ad, 'market/': { products } }))).toEqual({
      new: { amount: 39.99, currency: 'USD' },
      used: { low: 15, high: 25, count: 3, currency: 'USD' },
    });
    expect(await boardGamePrice('13', respond({ 'amazon/': new Error(), 'market/': { products } }))).toEqual({
      used: { low: 15, high: 25, count: 3, currency: 'USD' },
    });
    expect(await boardGamePrice('13', respond({ 'amazon/': [], 'market/': { products: [] } }))).toBeNull();
    await expect(boardGamePrice('13', respond({ 'amazon/': new Error(), 'market/': new Error() }))).rejects.toThrow();
  });
});
