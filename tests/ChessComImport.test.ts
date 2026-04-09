import {
  createSyntheticPgnFile,
  filterMonthlyArchiveGames,
  importChessComGames,
  selectRecentArchiveUrls,
} from '../ChessComImport';

describe('ChessComImport', () => {
  test('selects recent archives newest first', () => {
    const selected = selectRecentArchiveUrls(
      [
        'https://api.chess.com/pub/player/example/games/2026/01',
        'https://api.chess.com/pub/player/example/games/2026/02',
        'https://api.chess.com/pub/player/example/games/2026/03',
      ],
      2
    );

    expect(selected).toEqual([
      'https://api.chess.com/pub/player/example/games/2026/03',
      'https://api.chess.com/pub/player/example/games/2026/02',
    ]);
  });

  test('filters to the requested player and supported live chess time controls', () => {
    const filtered = filterMonthlyArchiveGames(
      [
        {
          white: { username: 'KindaguyBryan' },
          black: { username: 'Other' },
          rules: 'chess',
          time_class: 'rapid',
          pgn: '[Event "Rapid"]\n\n1. e4 e5 1-0',
        },
        {
          white: { username: 'KindaguyBryan' },
          black: { username: 'Other' },
          rules: 'chess960',
          time_class: 'rapid',
          pgn: '[Event "Variant"]\n\n1. e4 e5 1-0',
        },
        {
          white: { username: 'Other' },
          black: { username: 'KindaguyBryan' },
          rules: 'chess',
          time_class: 'blitz',
          pgn: '[Event "Blitz"]\n\n1. d4 d5 0-1',
        },
      ],
      'kindaguybryan',
      ['rapid']
    );

    expect(filtered).toHaveLength(1);

    const syntheticFile = createSyntheticPgnFile({
      username: 'KindaguyBryan',
      archiveUrl: 'https://api.chess.com/pub/player/kindaguybryan/games/2026/03',
      games: filtered,
      timeControls: ['rapid'],
    });

    expect(syntheticFile.originalname).toBe('chesscom-kindaguybryan-rapid-2026-03.pgn');
    expect(syntheticFile.buffer.toString('utf8')).toContain('[Event "Rapid"]');
  });

  test('imports all matching archive months within the selected window', async () => {
    const responses = new Map<string, unknown>([
      [
        'https://api.chess.com/pub/player/kindaguybryan/games/archives',
        {
          archives: [
            'https://api.chess.com/pub/player/kindaguybryan/games/2026/01',
            'https://api.chess.com/pub/player/kindaguybryan/games/2026/02',
            'https://api.chess.com/pub/player/kindaguybryan/games/2026/03',
          ],
        },
      ],
      [
        'https://api.chess.com/pub/player/kindaguybryan/games/2026/03',
        {
          games: [
            {
              white: { username: 'KindaguyBryan' },
              black: { username: 'Other' },
              rules: 'chess',
              time_class: 'blitz',
              pgn: '[Event "Blitz"]\n\n1. e4 e5 1-0',
            },
          ],
        },
      ],
      [
        'https://api.chess.com/pub/player/kindaguybryan/games/2026/02',
        {
          games: [
            {
              white: { username: 'KindaguyBryan' },
              black: { username: 'Other' },
              rules: 'chess',
              time_class: 'rapid',
              pgn: '[Event "Rapid"]\n\n1. e4 e5 1-0',
            },
          ],
        },
      ],
      [
        'https://api.chess.com/pub/player/kindaguybryan/games/2026/01',
        {
          games: [
            {
              white: { username: 'Other' },
              black: { username: 'KindaguyBryan' },
              rules: 'chess',
              time_class: 'rapid',
              pgn: '[Event "Rapid January"]\n\n1. d4 d5 0-1',
            },
          ],
        },
      ],
    ]);

    const fetchFn = vi.fn(async (url: string) => ({
      ok: true,
      status: 200,
      json: async () => responses.get(url),
    }));

    const imported = await importChessComGames({
      username: 'KindaguyBryan',
      monthsBack: 3,
      timeControls: ['rapid'],
      fetchFn,
    });

    expect(fetchFn).toHaveBeenCalledTimes(4);
    expect(imported.selectedArchiveUrls).toEqual([
      'https://api.chess.com/pub/player/kindaguybryan/games/2026/02',
      'https://api.chess.com/pub/player/kindaguybryan/games/2026/01',
    ]);
    expect(imported.importedGamesCount).toBe(2);
    expect(imported.files).toHaveLength(2);
    expect(imported.files[0].buffer.toString('utf8')).toContain('[Event "Rapid"]');
    expect(imported.files[1].buffer.toString('utf8')).toContain('[Event "Rapid January"]');
  });
});
