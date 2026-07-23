<?php get_header(); ?>

<section class="hero">
    <div class="hero__content">
        <p class="eyebrow">Preflight-first product information management</p>
        <h1>Marketplace-ready product data from one governed catalog.</h1>
        <p class="hero__lead">Vexa PIM helps commerce teams centralize product information, manage catalog data quality, govern approvals, and prepare product data before commerce-channel execution.</p>
        <div class="button-row">
            <?php echo vexa_button('Talk to Sales', vexa_sales_url('home-hero'), 'primary', 'home-hero'); ?>
            <?php echo vexa_button('Book a Demo', home_url('/demo/'), 'secondary', 'home-hero'); ?>
        </div>
    </div>
    <div class="product-visual app-shell-preview" aria-label="Vexa PIM product workbench preview">
        <div class="product-visual__top"><span></span><span></span><span></span></div>
        <div class="product-visual__body">
            <div class="visual-sidebar">
                <img src="<?php echo esc_url(get_template_directory_uri() . '/assets/brand/app_icon.svg'); ?>" alt="" aria-hidden="true">
                <span></span><span></span><span></span><span></span>
            </div>
            <div class="visual-table">
                <div class="visual-stat-row">
                    <div>
                        <small>Product Workbench</small>
                        <strong>Catalog readiness</strong>
                    </div>
                    <b>Review</b>
                </div>
                <div class="visual-row is-ready"><span><strong>Printed cotton kurta</strong><small>Attributes reviewed</small></span><b>Ready</b></div>
                <div class="visual-row is-warning"><span><strong>Bluetooth earbuds</strong><small>Media review needed</small></span><b>Review</b></div>
                <div class="visual-row is-blocked"><span><strong>Wooden dining chair</strong><small>Required field missing</small></span><b>Fix</b></div>
                <div class="connector-strip"><span>Catalog</span><span>Quality</span><span>Workflow</span></div>
            </div>
        </div>
    </div>
</section>

<section class="section-band">
    <div class="section-heading">
        <p class="eyebrow">Workflow</p>
        <h2>From product records to channel-ready information</h2>
    </div>
    <?php vexa_catalog_workflow_infographic(); ?>
</section>

<section class="section-band product-flow-section">
    <div class="section-heading">
        <p class="eyebrow">What Vexa offers</p>
        <h2>See the product-data flow inside Vexa</h2>
        <p>These app-page visuals show how teams move from a governed catalog to enrichment, quality review, approvals, and commerce preparation.</p>
    </div>
    <?php vexa_product_flow_showcase(); ?>
</section>

<section class="split-section">
    <div>
        <p class="eyebrow">The old way</p>
        <h2>Catalog work slows down when product truth lives in scattered files</h2>
        <ul class="check-list check-list--pain">
            <li>Teams edit the same product information in disconnected spreadsheets.</li>
            <li>Required attributes, media, and taxonomy fields are discovered too late.</li>
            <li>Approvals happen outside the catalog workflow.</li>
            <li>Teams lack a clear preflight view before commerce-channel execution.</li>
        </ul>
    </div>
    <div>
        <p class="eyebrow">The Vexa way</p>
        <h2>Govern product data before channel execution</h2>
        <ul class="check-list">
            <li>Centralize product records, variants, media, and data ownership.</li>
            <li>Use readiness checks to surface missing or inconsistent product data.</li>
            <li>Route products through editor, reviewer, and approver workflows.</li>
            <li>Prepare product information for marketplace, storefront, retail, and custom needs.</li>
        </ul>
    </div>
</section>

<section class="section-band">
    <div class="section-heading">
        <p class="eyebrow">Core platform</p>
        <h2>Built for catalog teams that need quality before execution</h2>
    </div>
    <div class="feature-grid">
        <article><span class="feature-icon">CM</span><h3>Catalog management</h3><p>Model products, variants, attributes, taxonomy, and media in one governed workspace.</p></article>
        <article><span class="feature-icon">DQ</span><h3>Data quality and readiness</h3><p>Use preflight checks to find missing fields, inconsistent values, and content gaps before handoff.</p></article>
        <article><span class="feature-icon">WF</span><h3>Workflow approvals</h3><p>Give editors, reviewers, approvers, and technical teams a shared operating path.</p></article>
    </div>
</section>

<section class="split-section split-section--visual">
    <div>
        <p class="eyebrow">Why teams choose Vexa</p>
        <h2>Move from reactive listing cleanup to planned product-data operations</h2>
        <p>Vexa is designed for teams that need to know whether product data is complete, reviewed, and ready for the next commercial step. Instead of waiting for downstream errors, teams can identify gaps earlier and keep catalog work moving with clearer ownership.</p>
        <div class="button-row">
            <?php echo vexa_button('Talk to Sales', vexa_sales_url('home-proof'), 'primary', 'home-proof'); ?>
        </div>
    </div>
    <div class="insight-panel">
        <article><strong>Data quality</strong><span>Spot missing attributes, weak media, taxonomy gaps, and review needs before handoff.</span></article>
        <article><strong>Team governance</strong><span>Separate editing, reviewing, approving, and technical planning responsibilities.</span></article>
        <article><strong>Commerce preparation</strong><span>Organize product information for marketplace, storefront, retail, or custom workflows.</span></article>
    </div>
</section>

<section class="section-band ecosystem-section">
    <div class="section-heading">
        <p class="eyebrow">Commerce ecosystem</p>
        <h2>Prepare product information for the commerce channels that matter to your business.</h2>
        <p>Use Vexa as the product-data control layer while your team discusses the right marketplace, storefront, retail, or custom implementation path.</p>
    </div>
    <?php vexa_ecosystem_infographic(); ?>
    <div class="button-row button-row--center">
        <?php echo vexa_button('Discuss Your Integration Needs', home_url('/demo/?intent=integration-needs'), 'primary', 'home-ecosystem'); ?>
    </div>
</section>

<section class="section-band">
    <div class="section-heading">
        <p class="eyebrow">Teams</p>
        <h2>One product-data workspace for every stakeholder</h2>
    </div>
    <div class="role-grid">
        <article><h3>Catalog managers</h3><p>Own attributes, media, variants, taxonomy, and product completeness from a single catalog view.</p></article>
        <article><h3>eCommerce leaders</h3><p>See where catalog readiness, team approvals, and channel preparation need attention.</p></article>
        <article><h3>Marketplace teams</h3><p>Prepare the product-data areas that matter before sales or implementation discussions.</p></article>
        <article><h3>Technical teams</h3><p>Discuss source systems, API needs, webhook events, data movement, and account requirements with context.</p></article>
    </div>
</section>

<section class="section-band">
    <div class="section-heading">
        <p class="eyebrow">Learn</p>
        <h2>Start with the product-data problem your team is trying to solve</h2>
        <p>These guides help buyers connect common search questions to the Vexa catalog workflow before they speak with sales.</p>
    </div>
    <div class="feature-grid">
        <article><h3>What is PIM?</h3><p>Understand how product information management centralizes catalog data, attributes, variants, media, approvals, and readiness work.</p><?php echo vexa_button('Read Guide', home_url('/resources/what-is-pim/'), 'secondary', 'home-resource-pim'); ?></article>
        <article><h3>PIM vs spreadsheets</h3><p>Compare scattered files with governed product-data workflows for growing catalog and ecommerce teams.</p><?php echo vexa_button('Compare Workflows', home_url('/resources/pim-vs-spreadsheets/'), 'secondary', 'home-resource-spreadsheets'); ?></article>
        <article><h3>Product data quality</h3><p>Review completeness, consistency, validation, ownership, and issue-resolution practices before commerce execution.</p><?php echo vexa_button('Improve Quality', home_url('/resources/product-data-quality-guide/'), 'secondary', 'home-resource-quality'); ?></article>
    </div>
</section>

<section class="pricing-teaser">
    <div>
        <p class="eyebrow">Plans</p>
        <h2>Plans for every catalog stage</h2>
    </div>
    <div class="mini-pricing">
        <span><strong>TRIAL</strong> Focused evaluation</span>
        <span><strong>STARTER</strong> Small catalogs</span>
        <span><strong>GROWTH</strong> Growing teams</span>
        <span><strong>BUSINESS</strong> High-volume operations</span>
        <span><strong>ENTERPRISE</strong> Complex requirements</span>
    </div>
    <?php echo vexa_button('See Plans', home_url('/plans/'), 'secondary', 'plans-teaser'); ?>
</section>

<section class="cta-band">
    <h2>Ready to preflight your product data?</h2>
    <p>Talk with Vexa about your catalog governance, data-quality, and commerce-channel planning needs.</p>
    <div class="button-row">
        <?php echo vexa_button('Talk to Sales', vexa_sales_url('home-bottom'), 'primary', 'home-bottom'); ?>
        <?php echo vexa_button('Book a Demo', home_url('/demo/'), 'secondary', 'home-bottom'); ?>
    </div>
</section>

<section class="faq-section">
    <div class="section-heading">
        <p class="eyebrow">FAQ</p>
        <h2>Common questions</h2>
    </div>
    <?php vexa_render_faq([
        ['q' => 'What does Vexa PIM help teams do?', 'a' => 'Vexa helps teams govern product records, improve data readiness, manage workflow approvals, and prepare information for commerce-channel execution.'],
        ['q' => 'Does the website confirm integration availability?', 'a' => 'No. Integration scope depends on account requirements, implementation needs, and commercial priorities. Vexa discusses those details privately during sales or demo conversations.'],
        ['q' => 'Can Vexa replace spreadsheet-based catalog work?', 'a' => 'Yes. Vexa is designed to move product data, reviews, readiness checks, and approval work into a governed PIM workspace.'],
        ['q' => 'Who should join the demo?', 'a' => 'Catalog, ecommerce, operations, and technical stakeholders can all join so the team can review workflow and integration requirements together.'],
    ]); ?>
</section>

<?php get_footer(); ?>
