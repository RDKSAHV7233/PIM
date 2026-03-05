import { Injectable } from "@nestjs/common";
import { AmazonConnector } from "../connectors/amazon/amazon.connector";
import { FlipkartConnector } from "../connectors/flipkart/flipkart.connector";
import { MeeshoConnector } from "../connectors/meesho/meesho.connector";
import { ConnectorNotFoundError } from "./connector.errors";
import { ConnectorInterface } from "./connector.interface";

@Injectable()
export class ConnectorRegistry {
  private readonly connectors = new Map<string, ConnectorInterface>();

  constructor(
    amazonConnector: AmazonConnector,
    flipkartConnector: FlipkartConnector,
    meeshoConnector: MeeshoConnector,
  ) {
    this.register(amazonConnector);
    this.register(flipkartConnector);
    this.register(meeshoConnector);
  }

  private register(connector: ConnectorInterface) {
    this.connectors.set(connector.slug, connector);
  }

  getConnector(slug: string): ConnectorInterface {
    const connector = this.connectors.get(slug);
    if (!connector) {
      throw new ConnectorNotFoundError(slug);
    }
    return connector;
  }

  listConnectors(): ConnectorInterface[] {
    return Array.from(this.connectors.values());
  }
}
