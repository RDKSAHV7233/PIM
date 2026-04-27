import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { DisallowApiClient } from "../common/rbac/api-client-policy.decorator";
import { AuthenticatedReadRoute } from "../common/rbac/read-access-policy.decorator";
import { Roles } from "../common/rbac/roles";
import { CreateOndcMappingDto } from "./dto/create-ondc-mapping.dto";
import { OndcService } from "./ondc.service";

@Controller("ondc")
@DisallowApiClient()
@AuthenticatedReadRoute({ classification: "admin_only", responseHandling: "none", apiClientPolicy: "denied_human_only" })
@Roles("admin")
export class OndcController {
  constructor(private readonly ondcService: OndcService) {}

  @Get("versions")
  listVersions() {
    return this.ondcService.listVersions();
  }

  @Post("mappings")
  createMapping(@Body() dto: CreateOndcMappingDto) {
    return this.ondcService.createMapping(dto);
  }

  @Get("mappings")
  listMappings(
    @Query("nodeType") nodeType?: string,
    @Query("version") version?: string,
    @Query("categoryId") categoryId?: string,
  ) {
    return this.ondcService.listMappings(nodeType, version, categoryId);
  }

  @Get("mappings/:id")
  getMapping(@Param("id") id: string) {
    return this.ondcService.getMapping(id);
  }

  @Post("products/:id/simulate")
  simulateProduct(
    @Param("id") productId: string,
    @Body()
    body: {
      nodeType: string;
      version: string;
      mappingId?: string;
    },
  ) {
    return this.ondcService.simulateProduct(productId, body.nodeType, body.version, body.mappingId);
  }

  @Get("products/:id/simulate")
  simulateProductGet(
    @Param("id") productId: string,
    @Query("nodeType") nodeType: string,
    @Query("version") version: string,
    @Query("mappingId") mappingId?: string,
  ) {
    return this.ondcService.simulateProduct(productId, nodeType, version, mappingId);
  }
}
