import { Controller, Get, Query } from '@nestjs/common';
import { type AuthenticatedUser, CurrentUser } from '../auth/auth.guard.js';
import { SearchService, type SearchHit } from './search.service.js';

/**
 * Not nested under `:slug`: FR-1.6 search spans projects, and the service
 * scopes it to the caller's memberships rather than a guard on one project.
 */
@Controller('search')
export class SearchController {
  constructor(private readonly search: SearchService) {}

  @Get()
  query(
    @CurrentUser() user: AuthenticatedUser,
    @Query('q') q = '',
    @Query('limit') limit?: string,
  ): Promise<SearchHit[]> {
    return this.search.search(
      user,
      q,
      Math.min(Number.parseInt(limit ?? '25', 10) || 25, 100),
    );
  }
}
