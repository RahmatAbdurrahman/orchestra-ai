import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Permission } from '@orchestra/domain';
import type { Response } from 'express';
import type { AuthUser } from '../../common/auth-user';
import { CurrentUser, RequireAnyPermission, RequirePermissions } from '../../common/decorators';
import { VerifyDocumentDto } from './documents.dto';
import { DocumentsService } from './documents.service';

const READ = [Permission.REQUESTS_READ_ALL, Permission.REQUESTS_READ_OWN, Permission.REQUESTS_READ_ASSIGNED];
/** Hard transport limit; the workflow's own (smaller) limit is enforced by the service. */
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

@ApiTags('Documents')
@ApiCookieAuth()
@Controller()
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Post('purchase-requests/:id/documents')
  @RequirePermissions(Permission.REQUESTS_CREATE)
  // No `dest`/`storage`: multer keeps the upload in memory so it can be validated before anything is written.
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } }))
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } }, required: ['file'] } })
  @ApiOperation({ summary: 'Upload a supporting document (PDF, PNG or JPEG; content is verified)' })
  upload(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    return this.documents.upload(user, id, file);
  }

  @Post('documents/:id/process')
  @HttpCode(202)
  @RequirePermissions(Permission.REQUESTS_CREATE)
  @ApiOperation({ summary: 'Re-run document intelligence for a document (request must be waiting for verification)' })
  process(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.documents.process(user, id);
  }

  @Get('documents/:id')
  @RequireAnyPermission(...READ)
  @ApiOperation({ summary: 'Document metadata, extraction result and fields that need confirmation' })
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.documents.get(user, id);
  }

  @Get('documents/:id/file')
  @RequireAnyPermission(...READ)
  @ApiOperation({ summary: 'Download / preview the original file' })
  async file(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const { document, stream } = await this.documents.openFile(user, id);
    const asciiName = document.fileName.replace(/[^\x20-\x7e]/g, '_');
    response.setHeader('Content-Type', document.mimeType);
    response.setHeader(
      'Content-Disposition',
      `inline; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(document.fileName)}`,
    );
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cache-Control', 'private, no-store');
    return new StreamableFile(stream);
  }

  @Patch('documents/:id/verify')
  @RequirePermissions(Permission.REQUESTS_CREATE)
  @ApiOperation({ summary: 'Verify / correct the extracted data and send the request for approval' })
  verify(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: VerifyDocumentDto) {
    return this.documents.verify(user, id, body);
  }
}
