import { describe, expect, it } from 'vitest';
import { compilePath, matchPath, parseQuery } from './match';

describe('matchPath', () => {
  it('matches the root only for "/"', () => {
    const root = compilePath('/');
    expect(matchPath(root, '/')).toEqual({});
    expect(matchPath(root, '/dashboard')).toBeNull();
  });

  it('matches static paths, with or without a trailing slash', () => {
    const route = compilePath('/worker/earnings');
    expect(matchPath(route, '/worker/earnings')).toEqual({});
    expect(matchPath(route, '/worker/earnings/')).toEqual({});
    expect(matchPath(route, '/worker')).toBeNull();
    expect(matchPath(route, '/worker/earnings/extra')).toBeNull();
  });

  it('extracts and decodes params', () => {
    const route = compilePath('/tasks/:id');
    expect(matchPath(route, '/tasks/abc-123')).toEqual({ id: 'abc-123' });
    expect(matchPath(route, '/tasks/a%20b')).toEqual({ id: 'a b' });
  });

  it('does not let a param swallow a nested path', () => {
    const route = compilePath('/tasks/:id');
    expect(matchPath(route, '/tasks/abc/extra')).toBeNull();
  });

  it('keeps /tasks/new distinct from /tasks/:id when ordered first', () => {
    const fixed = compilePath('/tasks/new');
    const dynamic = compilePath('/tasks/:id');
    expect(matchPath(fixed, '/tasks/new')).toEqual({});
    expect(matchPath(dynamic, '/tasks/new')).toEqual({ id: 'new' });
  });

  it('rejects a malformed percent-encoding instead of throwing', () => {
    expect(matchPath(compilePath('/tasks/:id'), '/tasks/%E0%A4%A')).toBeNull();
  });

  it('matches multi-param paths', () => {
    const route = compilePath('/admin/disputes/:id');
    expect(matchPath(route, '/admin/disputes/d1')).toEqual({ id: 'd1' });
  });
});

describe('parseQuery', () => {
  it('parses a query string and keeps the first duplicate', () => {
    expect(parseQuery('?token=abc&x=1&x=2')).toEqual({ token: 'abc', x: '1' });
  });

  it('returns an empty object for no query', () => {
    expect(parseQuery('')).toEqual({});
  });
});
