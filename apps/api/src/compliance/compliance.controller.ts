import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { ComplianceService } from "./compliance.service";
import { CreateComplianceRuleDto } from "./dto/create-compliance-rule.dto";
import { UpdateComplianceRuleDto } from "./dto/update-compliance-rule.dto";

@Controller("compliance")
export class ComplianceController {
  constructor(private readonly complianceService: ComplianceService) {}

  @Get("rules")
  listRules(@Query("categoryId") categoryId?: string) {
    return this.complianceService.listRules(categoryId);
  }

  @Post("rules")
  createRule(@Body() dto: CreateComplianceRuleDto) {
    return this.complianceService.createRule(dto);
  }

  @Patch("rules/:id")
  updateRule(@Param("id") id: string, @Body() dto: UpdateComplianceRuleDto) {
    return this.complianceService.updateRule(id, dto);
  }

  @Delete("rules/:id")
  deleteRule(@Param("id") id: string) {
    return this.complianceService.deleteRule(id);
  }

  @Post("products/:id/validate")
  validateProduct(@Param("id") productId: string) {
    return this.complianceService.validateAndPersistProduct(productId);
  }

  @Get("products/:id/issues")
  getProductIssues(@Param("id") productId: string) {
    return this.complianceService.getProductIssues(productId);
  }
}
