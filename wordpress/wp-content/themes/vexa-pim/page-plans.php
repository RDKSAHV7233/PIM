<?php get_header(); ?>

<section class="page-hero">
    <p class="eyebrow">Plans</p>
    <h1>Plans for every catalog stage.</h1>
    <p>Choose the right commercial path for your product-data maturity, governance needs, and commerce-channel planning requirements.</p>
    <div class="button-row">
        <?php echo vexa_button('Talk to Sales', vexa_sales_url('plans-hero'), 'primary', 'plans-hero'); ?>
        <?php echo vexa_button('Book a Demo', home_url('/demo/'), 'secondary', 'plans-hero'); ?>
    </div>
</section>

<section class="pricing-grid">
    <?php
    $plans = [
        [
            'name' => 'TRIAL',
            'price' => 'Focused evaluation',
            'description' => 'For evaluating Vexa with a focused sample catalog and a small set of governance questions.',
            'details' => ['Create a focused sample catalog', 'Explore product records and variants', 'Review enrichment and quality-check flow', 'See how approval ownership is represented', 'Understand whether Vexa fits your current catalog process'],
            'cta' => 'Start Free Trial',
            'variant' => 'primary',
            'url' => 'https://app.vexapim.com/signup?lang=en',
        ],
        [
            'name' => 'STARTER',
            'price' => 'Small catalogs',
            'description' => 'For teams moving early catalog governance, ownership, and review steps out of spreadsheets.',
            'details' => ['Centralize core product information', 'Organize variants, attributes, taxonomy, and media context', 'Standardize catalog review steps', 'Track basic ownership and approval needs', 'Prepare cleaner product data before channel execution'],
            'cta' => 'Contact Sales',
            'variant' => 'enterprise',
            'url' => vexa_sales_url('plan-starter'),
        ],
        [
            'name' => 'GROWTH',
            'price' => 'Growing product teams',
            'description' => 'For teams managing more products, more contributors, and more repeatable product-data workflows.',
            'details' => ['Coordinate catalog work across roles', 'Improve completeness and consistency checks', 'Support repeatable enrichment and approval workflows', 'Prepare marketplace, storefront, retail, or custom data areas', 'Discuss source-system and implementation planning needs'],
            'cta' => 'Book a Demo',
            'variant' => 'enterprise',
            'url' => home_url('/demo/'),
        ],
        [
            'name' => 'BUSINESS',
            'price' => 'High-volume operations',
            'description' => 'For larger catalog operations that need stronger governance, collaboration, and workflow visibility.',
            'details' => ['Manage higher operational complexity', 'Align multiple teams around governed product-data readiness', 'Review catalog quality, approvals, and operational ownership', 'Plan API, webhook, mapping, and account questions', 'Discuss implementation controls and commercial support needs'],
            'cta' => 'Talk to Sales',
            'variant' => 'enterprise',
            'url' => vexa_sales_url('plan-business'),
        ],
        [
            'name' => 'ENTERPRISE',
            'price' => 'Complex requirements',
            'description' => 'For organizations with advanced governance, integration planning, security, and commercial requirements.',
            'details' => ['Plan advanced governance and security requirements', 'Discuss API, webhook, and integration needs privately', 'Review data movement, account structure, and implementation ownership', 'Align support, onboarding, and commercial terms', 'Coordinate procurement, security, and stakeholder review'],
            'cta' => 'Contact Sales',
            'variant' => 'enterprise',
            'url' => vexa_sales_url('plan-enterprise'),
        ],
    ];
    foreach ($plans as $plan) : ?>
        <article class="pricing-card">
            <h2><?php echo esc_html($plan['name']); ?></h2>
            <strong class="pricing-card__price"><?php echo esc_html($plan['price']); ?></strong>
            <p><?php echo esc_html($plan['description']); ?></p>
            <ul class="check-list pricing-card__details">
                <?php foreach ($plan['details'] as $detail) : ?>
                    <li><?php echo esc_html($detail); ?></li>
                <?php endforeach; ?>
            </ul>
            <?php echo vexa_button($plan['cta'], $plan['url'], $plan['variant'], 'plans'); ?>
        </article>
    <?php endforeach; ?>
</section>

<section class="section-band">
    <div class="section-heading">
        <p class="eyebrow">What plans include</p>
        <h2>Core Vexa capabilities discussed across commercial plans</h2>
        <p>Exact limits and commercial terms are confirmed privately, but buyers should understand the product areas Vexa is built around.</p>
    </div>
    <div class="feature-grid">
        <article><h3>Catalog management</h3><p>Product records, variants, attributes, taxonomy, media context, ownership, and catalog operating structure.</p></article>
        <article><h3>Data quality and readiness</h3><p>Completeness review, consistency checks, required-field planning, media readiness, and issue-resolution workflow.</p></article>
        <article><h3>Workflow and approvals</h3><p>Editor, reviewer, approver, ecommerce, operations, and technical planning responsibilities in one governed flow.</p></article>
        <article><h3>Commerce preparation</h3><p>Structured product data, channel-field planning, setup questions, and implementation notes before commerce execution.</p></article>
        <article><h3>API and webhook planning</h3><p>Source systems, data movement, events, webhook needs, destination workflows, and technical ownership discussions.</p></article>
        <article><h3>Security and governance review</h3><p>Role access, permissions, review queues, approval history, account questions, and onboarding safeguards.</p></article>
    </div>
</section>

<section class="split-section">
    <div>
        <p class="eyebrow">Plan differences</p>
        <h2>Plans scale by catalog maturity and operating complexity</h2>
        <p>The main difference between plans is not public price or a single SKU number. It is how much governance, team coordination, implementation planning, and commercial support your catalog operation needs.</p>
    </div>
    <div class="insight-panel">
        <article><strong>Starter to Growth</strong><span>Move from basic catalog governance to repeatable product-data workflows across more contributors and product areas.</span></article>
        <article><strong>Growth to Business</strong><span>Add stronger operating visibility, multi-team governance, and deeper implementation planning around source systems and controls.</span></article>
        <article><strong>Business to Enterprise</strong><span>Bring in advanced security, procurement, integration planning, stakeholder review, and commercial requirements.</span></article>
    </div>
</section>

<section class="comparison-section">
    <div class="section-heading">
        <p class="eyebrow">Comparison</p>
        <h2>Match the plan to your catalog maturity</h2>
        <p>Plans are described qualitatively while commercial terms and enforcement limits are confirmed privately with the Vexa team.</p>
    </div>
    <?php vexa_plans_infographic(); ?>
</section>

<section class="split-section">
    <div>
        <p class="eyebrow">Buying guidance</p>
        <h2>Pick based on operating complexity, not only catalog size</h2>
        <p>The right plan depends on product-data maturity, number of contributors, approval rigor, implementation needs, technical requirements, and commercial support expectations.</p>
    </div>
    <div>
        <p class="eyebrow">Sales discussion</p>
        <ul class="check-list">
            <li>Catalog stage and product-data quality issues.</li>
            <li>Team roles, approval workflows, and governance needs.</li>
            <li>Commerce-channel planning and account requirements.</li>
            <li>Security, API, webhook, and implementation questions.</li>
        </ul>
    </div>
</section>

<section class="content-section">
    <div class="section-heading">
        <p class="eyebrow">Decision support</p>
        <h2>Choose a plan after reviewing your catalog operating model</h2>
        <p>These resources help teams clarify whether the main problem is spreadsheet governance, data quality, integration planning, or catalog workflow maturity.</p>
    </div>
    <?php vexa_internal_link_cluster(); ?>
</section>

<section class="faq-section">
    <div class="section-heading">
        <p class="eyebrow">FAQ</p>
        <h2>Plan questions</h2>
    </div>
    <?php vexa_render_faq([
        ['q' => 'Why are public plan limits not listed?', 'a' => 'Vexa publishes plan limits only after the Product Owner confirms they match application enforcement and current commercial policy.'],
        ['q' => 'Can we discuss exact commercial terms?', 'a' => 'Yes. Talk to Sales to review catalog volume, users, workflow complexity, implementation needs, and commercial terms.'],
        ['q' => 'Which plan should we start with?', 'a' => 'The right plan depends on catalog maturity, product-data governance needs, team structure, and implementation requirements.'],
        ['q' => 'Can Vexa work with complex enterprise requirements?', 'a' => 'Yes. Enterprise discussions cover governance, security, integration planning, account structure, and commercial needs.'],
    ]); ?>
</section>

<section class="cta-band">
    <h2>Discuss the right Vexa plan.</h2>
    <p>Tell us about your catalog, team, and workflow requirements.</p>
    <div class="button-row">
        <?php echo vexa_button('Talk to Sales', vexa_sales_url('plans-bottom'), 'primary', 'plans-bottom'); ?>
        <?php echo vexa_button('Book a Demo', home_url('/demo/'), 'secondary', 'plans-bottom'); ?>
    </div>
</section>

<?php get_footer(); ?>
