import type { VideoCategory } from '../services/api'

/**
 * Same list as GET /api/v1/video-categories. Used only when that payload
 * does not include an array, so the import screen can still offer a category.
 */
export const DEFAULT_VIDEO_CATEGORIES: VideoCategory[] = [
  {
    value: 'default',
    name: 'Default',
    description: 'GeneralVideo contentProcess',
    icon: '🎬',
    color: '#4facfe',
  },
  {
    value: 'knowledge',
    name: 'Education',
    description: 'Science、Technology、History、Culture, etc.KnowledgeContent type',
    icon: '📚',
    color: '#52c41a',
  },
  {
    value: 'entertainment',
    name: 'Entertainment',
    description: 'Gaming、Music、Movies, etc.Entertainment',
    icon: '🎮',
    color: '#722ed1',
  },
  {
    value: 'business',
    name: 'Business',
    description: 'Business、Entrepreneurship、Commercial content such as investments',
    icon: '💼',
    color: '#fa8c16',
  },
  {
    value: 'experience',
    name: 'Experience sharing',
    description: 'Personal Experience、Life insights and other experiential content',
    icon: '🌟',
    color: '#eb2f96',
  },
  {
    value: 'opinion',
    name: 'Opinion',
    description: 'Current Affairs Commentary、OpinionAnalysisWait for comment content',
    icon: '💭',
    color: '#13c2c2',
  },
  {
    value: 'speech',
    name: 'Presentation',
    description: 'PublicPresentation、Lectures and other presentation content',
    icon: '🎤',
    color: '#f5222d',
  },
]

export function categoryOptions(categories: unknown): VideoCategory[] {
  return Array.isArray(categories) ? categories as VideoCategory[] : DEFAULT_VIDEO_CATEGORIES
}

/**
 * Normalize GET /video-categories.
 * An array (including empty) is kept. null, a missing field, or a non-array
 * falls back to the built-in list so callers never store a value without .map.
 */
export function applyCategoryResponse(response: unknown): {
  categories: VideoCategory[]
  selectedCategory?: string
} {
  const payload = response && typeof response === 'object'
    ? response as { categories?: unknown; default_category?: unknown }
    : {}
  const categories = categoryOptions(payload.categories)
  const preferred = payload.default_category
  if (typeof preferred === 'string' && preferred.length > 0) {
    return { categories, selectedCategory: preferred }
  }
  if (categories.length > 0) {
    return { categories, selectedCategory: categories[0].value }
  }
  return { categories }
}
