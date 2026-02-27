import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { BulkEditApplyDto } from "./dto/bulk-edit-apply.dto";
import { BulkEditPreviewDto } from "./dto/bulk-edit-preview.dto";
import { BulkEditService } from "./bulk-edit.service";

@Controller("bulk-edit")
export class BulkEditController {
  constructor(private readonly bulkEditService: BulkEditService) {}

  @Post("preview")
  preview(@Body() dto: BulkEditPreviewDto) {
    return this.bulkEditService.preview(dto.scope, dto.updates);
  }

  @Post("apply")
  apply(@Body() dto: BulkEditApplyDto) {
    return this.bulkEditService.apply(dto.scope, dto.updates);
  }

  @Get("operations")
  listOperations(@Query("limit") limit?: string) {
    return this.bulkEditService.listOperations(limit ? Number(limit) : undefined);
  }

  @Get("operations/:id")
  getOperation(@Param("id") operationId: string) {
    return this.bulkEditService.getOperation(operationId);
  }
}
