import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { formatProjects, formatScreens, formatScreen } from '../lib/format.js'

describe('formatProjects', () => {
  it('formats a list of projects as readable text', () => {
    const projects = [
      { id: 'p1', title: 'Landing Page', screenCount: 3 },
      { id: 'p2', title: 'Dashboard', screenCount: 7 },
    ]
    const result = formatProjects(projects)
    assert.equal(result, 'p1  Landing Page  (3 screens)\np2  Dashboard  (7 screens)')
  })

  it('returns JSON when json=true', () => {
    const projects = [{ id: 'p1', title: 'App', screenCount: 1 }]
    const result = formatProjects(projects, true)
    assert.equal(result, JSON.stringify(projects, null, 2))
  })

  it('returns "No projects found." for empty array', () => {
    assert.equal(formatProjects([]), 'No projects found.')
  })

  it('handles projects with missing/null titles gracefully', () => {
    const projects = [
      { id: 'p1', title: null, screenCount: 2 },
      { id: 'p2', screenCount: 5 },
    ]
    const result = formatProjects(projects)
    assert.equal(result, 'p1  Untitled  (2 screens)\np2  Untitled  (5 screens)')
  })
})

describe('formatScreens', () => {
  it('formats screens as readable text', () => {
    const screens = [
      { id: 's1', title: 'Home', deviceType: 'desktop' },
      { id: 's2', title: 'Settings', deviceType: 'mobile' },
    ]
    const result = formatScreens(screens)
    assert.equal(result, 's1  Home  [desktop]\ns2  Settings  [mobile]')
  })

  it('returns JSON when json=true', () => {
    const screens = [{ id: 's1', title: 'Home', deviceType: 'desktop' }]
    const result = formatScreens(screens, true)
    assert.equal(result, JSON.stringify(screens, null, 2))
  })

  it('returns "No screens found." for empty array', () => {
    assert.equal(formatScreens([]), 'No screens found.')
  })

  it('uses "Unknown" for missing deviceType', () => {
    const screens = [
      { id: 's1', title: 'Page' },
      { id: 's2', title: 'Other', deviceType: null },
    ]
    const result = formatScreens(screens)
    assert.equal(result, 's1  Page  [Unknown]\ns2  Other  [Unknown]')
  })
})

describe('formatScreen', () => {
  it('outputs raw HTML content from screen.html', () => {
    const screen = { id: 's1', html: '<div>Hello</div>' }
    assert.equal(formatScreen(screen), '<div>Hello</div>')
  })

  it('returns JSON when json=true', () => {
    const screen = { id: 's1', html: '<p>Hi</p>' }
    const result = formatScreen(screen, true)
    assert.equal(result, JSON.stringify(screen, null, 2))
  })

  it('returns empty string when screen has no HTML content', () => {
    const screen = { id: 's1', title: 'Empty' }
    assert.equal(formatScreen(screen), '')
  })

  it('prefers html over content when both are present', () => {
    const screen = {
      id: 's1',
      html: '<div>From html</div>',
      content: '<div>From content</div>',
    }
    assert.equal(formatScreen(screen), '<div>From html</div>')
  })
})
