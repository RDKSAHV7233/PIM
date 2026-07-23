<?php
if (!defined('ABSPATH')) {
    exit;
}

function vexa_theme_setup(): void
{
    add_theme_support('title-tag');
    add_theme_support('post-thumbnails');
    add_theme_support('html5', ['search-form', 'comment-form', 'comment-list', 'gallery', 'caption', 'style', 'script']);

    register_nav_menus([
        'primary' => __('Primary Menu', 'vexa-pim'),
        'footer' => __('Footer Menu', 'vexa-pim'),
    ]);
}
add_action('after_setup_theme', 'vexa_theme_setup');

function vexa_enqueue_assets(): void
{
    $theme_version = wp_get_theme()->get('Version');
    wp_enqueue_style('vexa-main', get_template_directory_uri() . '/assets/css/main.css', [], $theme_version);
    wp_enqueue_script('vexa-main', get_template_directory_uri() . '/assets/js/main.js', [], $theme_version, true);
}
add_action('wp_enqueue_scripts', 'vexa_enqueue_assets');
remove_action('wp_head', 'rel_canonical');

function vexa_site_icon(): void
{
    echo '<link rel="icon" href="' . esc_url(get_template_directory_uri() . '/assets/brand/favicon.svg') . '" type="image/svg+xml">' . "\n";
}
add_action('wp_head', 'vexa_site_icon');

function vexa_tracking_container_id(): string
{
    if (defined('VEXA_GTM_CONTAINER_ID')) {
        return sanitize_text_field((string) VEXA_GTM_CONTAINER_ID);
    }

    return sanitize_text_field((string) get_option('vexa_gtm_container_id', ''));
}

function vexa_tracking_head(): void
{
    $container_id = vexa_tracking_container_id();
    if (!$container_id || !preg_match('/^GTM-[A-Z0-9]+$/', $container_id)) {
        return;
    }
    ?>
    <script>
      window.dataLayer = window.dataLayer || [];
      window.dataLayer.push({'gtm.start': new Date().getTime(), event: 'gtm.js'});
    </script>
    <script async src="https://www.googletagmanager.com/gtm.js?id=<?php echo esc_attr($container_id); ?>"></script>
    <?php
}
add_action('wp_head', 'vexa_tracking_head', 0);

function vexa_tracking_body(): void
{
    $container_id = vexa_tracking_container_id();
    if (!$container_id || !preg_match('/^GTM-[A-Z0-9]+$/', $container_id)) {
        return;
    }
    ?>
    <noscript><iframe src="https://www.googletagmanager.com/ns.html?id=<?php echo esc_attr($container_id); ?>" height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>
    <?php
}
add_action('wp_body_open', 'vexa_tracking_body', 5);

function vexa_signup_url(string $location = 'general'): string
{
    return add_query_arg('lang', 'en', 'https://app.vexapim.com/signup');
}

function vexa_sales_url(string $location = 'general'): string
{
    return home_url('/demo/?intent=talk-sales&utm_campaign=' . rawurlencode($location));
}

function vexa_button(string $label, string $url, string $variant = 'primary', string $location = 'inline'): string
{
    $class = 'vexa-button vexa-button--' . sanitize_html_class($variant);
    return sprintf(
        '<a class="%s" href="%s" data-cta-location="%s">%s</a>',
        esc_attr($class),
        esc_url($url),
        esc_attr($location),
        esc_html($label)
    );
}

function vexa_seed_page(string $title, string $slug, int $parent_id = 0): int
{
    $existing = get_page_by_path($parent_id ? get_post_field('post_name', $parent_id) . '/' . $slug : $slug);
    if ($existing) {
        if ($existing->post_title !== $title) {
            wp_update_post([
                'ID' => (int) $existing->ID,
                'post_title' => $title,
            ]);
        }
        return (int) $existing->ID;
    }

    return (int) wp_insert_post([
        'post_title' => $title,
        'post_name' => $slug,
        'post_type' => 'page',
        'post_status' => 'publish',
        'post_parent' => $parent_id,
        'post_content' => '',
    ]);
}

function vexa_theme_seed_pages(): void
{
    $home_id = vexa_seed_page('Home', 'home');
    vexa_seed_page('Plans', 'plans');
    $demo_id = vexa_seed_page('Book a Demo', 'demo');
    vexa_seed_page('Thank You', 'thank-you', $demo_id);
    vexa_seed_page('Contact Us', 'contact');
    vexa_seed_page('About Us', 'about');
    $platform_id = vexa_seed_page('Platform Overview', 'platform');
    vexa_seed_page('Catalog Management', 'catalog-management', $platform_id);
    vexa_seed_page('Data Quality & Readiness', 'data-quality-readiness', $platform_id);
    vexa_seed_page('Workflow & Approvals', 'workflow-approvals', $platform_id);
    vexa_seed_page('Connector Automation', 'connector-automation', $platform_id);
    vexa_seed_page('API & Webhooks', 'api-webhooks', $platform_id);
    vexa_seed_page('Security', 'security', $platform_id);

    $solutions_id = vexa_seed_page('Solutions', 'solutions');
    vexa_seed_page('Marketplace Teams', 'marketplace-teams', $solutions_id);
    vexa_seed_page('Catalog Managers', 'catalog-managers', $solutions_id);
    vexa_seed_page('eCommerce Leaders', 'ecommerce-leaders', $solutions_id);
    vexa_seed_page('Technical Teams', 'technical-teams', $solutions_id);

    $resources_id = vexa_seed_page('Resources', 'resources');
    vexa_seed_page('What is PIM?', 'what-is-pim', $resources_id);
    vexa_seed_page('PIM vs Spreadsheets', 'pim-vs-spreadsheets', $resources_id);
    vexa_seed_page('Marketplace Listing Readiness Guide', 'marketplace-listing-readiness-guide', $resources_id);
    vexa_seed_page('Product Data Quality Guide', 'product-data-quality-guide', $resources_id);
    vexa_seed_page('Connector Planning Guide', 'connector-planning-guide', $resources_id);

    $legal_id = vexa_seed_page('Legal', 'legal');
    vexa_seed_page('Terms of Service', 'terms', $legal_id);
    vexa_seed_page('Privacy Policy', 'privacy', $legal_id);
    vexa_seed_page('Data Processing Agreement', 'dpa', $legal_id);

    if ($home_id && !get_option('page_on_front')) {
        update_option('show_on_front', 'page');
        update_option('page_on_front', $home_id);
    }
}
add_action('after_switch_theme', 'vexa_theme_seed_pages');

function vexa_theme_maybe_seed_pages(): void
{
    $version = '2026-07-19-page-labels-v2';
    if (get_option('vexa_theme_seed_version') === $version) {
        return;
    }

    vexa_theme_seed_pages();
    update_option('vexa_theme_seed_version', $version, false);
}
add_action('init', 'vexa_theme_maybe_seed_pages', 30);

function vexa_document_title_parts(array $title): array
{
    $title_map = [
        'plans' => __('Vexa PIM Plans for Catalog Governance Teams', 'vexa-pim'),
        'platform' => __('PIM Platform for Catalog Management and Product Data Quality', 'vexa-pim'),
        'integrations' => __('Commerce Ecosystem Planning for Product Data Workflows', 'vexa-pim'),
        'demo' => __('Book a Vexa PIM Demo for Product Data Workflows', 'vexa-pim'),
        'contact' => __('Contact Us - Vexa PIM Sales', 'vexa-pim'),
        'about' => __('About Us - Vexa PIM', 'vexa-pim'),
        'what-is-pim' => __('What Is PIM? Product Information Management Guide', 'vexa-pim'),
        'pim-vs-spreadsheets' => __('PIM vs Spreadsheets for Catalog Management', 'vexa-pim'),
        'marketplace-listing-readiness-guide' => __('Marketplace Listing Readiness Guide for Product Teams', 'vexa-pim'),
        'product-data-quality-guide' => __('Product Data Quality Guide for Commerce Catalogs', 'vexa-pim'),
        'connector-planning-guide' => __('Connector Planning Guide for PIM and Commerce Teams', 'vexa-pim'),
    ];

    if (is_front_page()) {
        $title['title'] = __('Vexa PIM - Preflight-First Product Information Management', 'vexa-pim');
        unset($title['tagline']);
        return $title;
    }

    if (is_post_type_archive('integration')) {
        $title['title'] = $title_map['integrations'];
        return $title;
    }

    if (is_singular('integration')) {
        $title['title'] = vexa_platform_display_name_from_current_post() . __(' Product Data Preparation', 'vexa-pim');
        return $title;
    }

    $slug = is_page() ? get_post_field('post_name', get_queried_object_id()) : '';
    if ($slug && isset($title_map[$slug])) {
        $title['title'] = $title_map[$slug];
    }

    return $title;
}
add_filter('document_title_parts', 'vexa_document_title_parts');

function vexa_seo_document_title(string $fallback = ''): string
{
    if (is_front_page()) {
        return 'Vexa PIM - Preflight-First Product Information Management';
    }

    if (is_post_type_archive('integration')) {
        return 'Commerce Ecosystem Planning for Product Data Workflows - Vexa PIM';
    }

    if (is_singular('integration')) {
        return vexa_platform_display_name_from_current_post() . ' Product Data Preparation - Vexa PIM';
    }

    $title_map = [
        'plans' => 'Vexa PIM Plans for Catalog Governance Teams - Vexa PIM',
        'platform' => 'PIM Platform for Catalog Management and Product Data Quality - Vexa PIM',
        'demo' => 'Book a Vexa PIM Demo for Product Data Workflows - Vexa PIM',
        'contact' => 'Contact Us - Vexa PIM Sales',
        'about' => 'About Us - Vexa PIM',
        'what-is-pim' => 'What Is PIM? Product Information Management Guide - Vexa PIM',
        'pim-vs-spreadsheets' => 'PIM vs Spreadsheets for Catalog Management - Vexa PIM',
        'marketplace-listing-readiness-guide' => 'Marketplace Listing Readiness Guide for Product Teams - Vexa PIM',
        'product-data-quality-guide' => 'Product Data Quality Guide for Commerce Catalogs - Vexa PIM',
        'connector-planning-guide' => 'Connector Planning Guide for PIM and Commerce Teams - Vexa PIM',
    ];

    $slug = is_page() ? get_post_field('post_name', get_queried_object_id()) : '';
    return $title_map[$slug] ?? $fallback;
}

function vexa_pre_get_document_title(string $title): string
{
    return vexa_seo_document_title($title);
}
add_filter('pre_get_document_title', 'vexa_pre_get_document_title', 99);

function vexa_redirect_legacy_routes(): void
{
    if (is_page('pricing')) {
        wp_safe_redirect(home_url('/plans/'), 301);
        exit;
    }

    $path = trim((string) wp_parse_url($_SERVER['REQUEST_URI'] ?? '', PHP_URL_PATH), '/');
    if ($path === 'integrations/amazon-india') {
        wp_safe_redirect(home_url('/integrations/amazon/'), 301);
        exit;
    }
}
add_action('template_redirect', 'vexa_redirect_legacy_routes', 1);

function vexa_page_meta(): array
{
    return [
        'home' => [
            'description' => 'Vexa PIM helps commerce teams centralize product information, govern catalog data quality, manage approvals, and prepare marketplace-ready product data.',
        ],
        'platform' => [
            'description' => 'Explore Vexa PIM for catalog management, taxonomy, variants, media governance, product data quality, approvals, API workflows, and security.',
        ],
        'integrations' => [
            'description' => 'Use Vexa PIM to plan product-data readiness for marketplaces, storefronts, retail systems, and custom commerce workflows without public availability claims.',
        ],
        'plans' => [
            'description' => 'Compare qualitative Vexa PIM plans for evaluation, small catalogs, growing product teams, high-volume catalog operations, and enterprise requirements.',
        ],
        'demo' => [
            'description' => 'Book a Vexa PIM demo to review catalog governance, product-data readiness, workflow approvals, and commerce-channel planning.',
        ],
        'contact' => [
            'description' => 'Contact Vexa PIM sales about catalog migration, product-data workflows, integration planning, API evaluation, and commercial questions.',
        ],
        'about' => [
            'description' => 'Learn how Vexa PIM helps commerce teams manage catalog complexity with governed product data and preflight-first workflows.',
        ],
        'what-is-pim' => [
            'description' => 'Learn what PIM means for product information, catalog management, attributes, variants, media, enrichment, validation, approvals, and channel preparation.',
        ],
        'pim-vs-spreadsheets' => [
            'description' => 'Compare governed PIM workflows with spreadsheet-based catalog management for attributes, variants, media, approvals, and readiness checks.',
        ],
        'marketplace-listing-readiness-guide' => [
            'description' => 'Review the product-data areas teams should prepare before marketplace listing discussions, from taxonomy and attributes to media and approvals.',
        ],
        'product-data-quality-guide' => [
            'description' => 'Use this product data quality guide to understand completeness, consistency, validation, ownership, and issue-resolution workflows in Vexa PIM.',
        ],
        'connector-planning-guide' => [
            'description' => 'Plan commerce integration discussions with clear product-data requirements, source systems, account needs, workflow ownership, APIs, and webhooks.',
        ],
        'catalog-management' => [
            'description' => 'Use Vexa PIM to organize product records, variants, attributes, categories, taxonomy, media, and catalog ownership in one governed workspace.',
        ],
        'data-quality-readiness' => [
            'description' => 'Improve product data quality with completeness checks, validation workflows, taxonomy review, media readiness, and approval ownership.',
        ],
        'workflow-approvals' => [
            'description' => 'Coordinate product data review and approvals across catalog, ecommerce, marketplace, operations, and technical stakeholders.',
        ],
        'api-webhooks' => [
            'description' => 'Plan API and webhook workflows for product data movement, source systems, commerce operations, and technical implementation discussions.',
        ],
    ];
}

function vexa_current_meta_description(): string
{
    $meta = vexa_page_meta();

    if (is_front_page()) {
        return $meta['home']['description'];
    }

    if (is_post_type_archive('integration')) {
        return $meta['integrations']['description'];
    }

    if (is_singular('integration')) {
        return 'Review product-data workflow considerations, business use cases, setup requirements, and planning guidance for this Vexa PIM commerce workflow.';
    }

    $slug = is_page() ? get_post_field('post_name', get_queried_object_id()) : '';
    if ($slug && isset($meta[$slug])) {
        return $meta[$slug]['description'];
    }

    if (is_page()) {
        return 'Explore Vexa PIM guidance for governed catalog operations, product-data quality, workflow approvals, and commerce-channel preparation.';
    }

    return 'Vexa PIM helps commerce teams govern product information and prepare catalog data for commerce-channel execution.';
}

function vexa_canonical_url(): string
{
    if (is_404()) {
        return home_url('/');
    }

    if (is_front_page()) {
        return home_url('/');
    }

    if (is_post_type_archive('integration')) {
        return get_post_type_archive_link('integration');
    }

    if (is_singular() || is_page()) {
        return get_permalink();
    }

    return home_url(add_query_arg([], $GLOBALS['wp']->request ?? ''));
}

function vexa_seo_tags(): void
{
    $description = vexa_current_meta_description();
    $canonical = vexa_canonical_url();
    $title = vexa_seo_document_title(wp_get_document_title());
    $image = get_template_directory_uri() . '/assets/brand/app_icon.svg';
    $noindex = is_page() && get_post_field('post_name', get_queried_object_id()) === 'thank-you';

    echo '<meta name="description" content="' . esc_attr($description) . '">' . "\n";
    if ($noindex || is_404()) {
        echo '<meta name="robots" content="noindex,follow">' . "\n";
    }
    if (!is_404()) {
        echo '<link rel="canonical" href="' . esc_url($canonical) . '">' . "\n";
    }
    echo '<meta property="og:title" content="' . esc_attr($title) . '">' . "\n";
    echo '<meta property="og:description" content="' . esc_attr($description) . '">' . "\n";
    echo '<meta property="og:type" content="website">' . "\n";
    echo '<meta property="og:url" content="' . esc_url($canonical) . '">' . "\n";
    echo '<meta property="og:image" content="' . esc_url($image) . '">' . "\n";
    echo '<meta name="twitter:card" content="summary">' . "\n";
}
add_action('wp_head', 'vexa_seo_tags', 1);

function vexa_schema(): void
{
    $graph = [
        [
            '@type' => 'Organization',
            '@id' => home_url('/#organization'),
            'name' => 'Vexa PIM',
            'url' => home_url('/'),
            'email' => 'sales@vexapim.com',
            'logo' => get_template_directory_uri() . '/assets/brand/app_icon.svg',
            'contactPoint' => [
                [
                    '@type' => 'ContactPoint',
                    'email' => 'sales@vexapim.com',
                    'contactType' => 'sales',
                    'availableLanguage' => ['en'],
                ],
            ],
        ],
        [
            '@type' => 'WebSite',
            '@id' => home_url('/#website'),
            'url' => home_url('/'),
            'name' => 'Vexa PIM',
            'publisher' => ['@id' => home_url('/#organization')],
        ],
        [
            '@type' => 'SoftwareApplication',
            '@id' => home_url('/#software'),
            'name' => 'Vexa PIM',
            'applicationCategory' => 'BusinessApplication',
            'operatingSystem' => 'Web',
            'description' => vexa_current_meta_description(),
            'publisher' => ['@id' => home_url('/#organization')],
        ],
        [
            '@type' => is_page('contact') ? 'ContactPage' : 'WebPage',
            '@id' => vexa_canonical_url() . '#webpage',
            'url' => vexa_canonical_url(),
            'name' => vexa_seo_document_title(wp_get_document_title()),
            'description' => vexa_current_meta_description(),
            'isPartOf' => ['@id' => home_url('/#website')],
        ],
    ];

    if (is_page() && wp_get_post_parent_id(get_queried_object_id())) {
        $ancestors = array_reverse(get_post_ancestors(get_queried_object_id()));
        $items = [[
            '@type' => 'ListItem',
            'position' => 1,
            'name' => 'Home',
            'item' => home_url('/'),
        ]];
        $position = 2;
        foreach ($ancestors as $ancestor_id) {
            $items[] = [
                '@type' => 'ListItem',
                'position' => $position++,
                'name' => get_the_title($ancestor_id),
                'item' => get_permalink($ancestor_id),
            ];
        }
        $items[] = [
            '@type' => 'ListItem',
            'position' => $position,
            'name' => get_the_title(),
            'item' => get_permalink(),
        ];
        $graph[] = [
            '@type' => 'BreadcrumbList',
            '@id' => vexa_canonical_url() . '#breadcrumbs',
            'itemListElement' => $items,
        ];
    }

    if (is_page() && wp_get_post_parent_id(get_queried_object_id()) && get_post_field('post_name', wp_get_post_parent_id(get_queried_object_id())) === 'resources') {
        $graph[] = [
            '@type' => 'Article',
            '@id' => vexa_canonical_url() . '#article',
            'headline' => get_the_title(),
            'description' => vexa_current_meta_description(),
            'author' => ['@id' => home_url('/#organization')],
            'publisher' => ['@id' => home_url('/#organization')],
            'mainEntityOfPage' => ['@id' => vexa_canonical_url() . '#webpage'],
        ];
    }

    $schema = [
        '@context' => 'https://schema.org',
        '@graph' => $graph,
    ];

    echo '<script type="application/ld+json">' . wp_json_encode($schema, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE) . '</script>' . "\n";
}
add_action('wp_head', 'vexa_schema', 20);

function vexa_form_field(string $name, string $label, string $type = 'text', bool $required = true, array $options = []): void
{
    $id = 'field-' . sanitize_html_class($name);
    $required_attr = $required ? ' required' : '';
    echo '<label for="' . esc_attr($id) . '">' . esc_html($label) . '</label>';

    if ($type === 'select') {
        echo '<select id="' . esc_attr($id) . '" name="' . esc_attr($name) . '"' . $required_attr . '>';
        echo '<option value="">Select</option>';
        foreach ($options as $option) {
            echo '<option value="' . esc_attr($option) . '">' . esc_html($option) . '</option>';
        }
        echo '</select>';
        return;
    }

    echo '<input id="' . esc_attr($id) . '" name="' . esc_attr($name) . '" type="' . esc_attr($type) . '"' . $required_attr . '>';
}

function vexa_form_tracking_fields(): void
{
    echo '<input type="text" name="website_url" class="vexa-hp-field" tabindex="-1" autocomplete="off" aria-hidden="true">';
    foreach (['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'intent', 'connector', 'connector_interest', 'cta_source'] as $field) {
        echo '<input type="hidden" name="' . esc_attr($field) . '" value="">';
    }
    echo '<label class="check-control"><input type="checkbox" name="privacy_consent" value="yes" required> I agree that Vexa may contact me about this request.</label>';
}

function vexa_form_notice(): void
{
    $error = isset($_GET['vexa_error']) ? sanitize_key(wp_unslash($_GET['vexa_error'])) : '';
    if (!$error) {
        return;
    }

    $messages = [
        'email' => 'Please enter a valid work email address.',
        'consent' => 'Please confirm consent before submitting the form.',
        'rate' => 'Too many submissions. Please wait a few minutes and try again.',
        'verification' => 'Form verification failed. Please refresh the page and try again.',
    ];
    $message = $messages[$error] ?? 'Something went wrong. Please review the form and try again.';
    echo '<div class="notice-error" role="alert">' . esc_html($message) . '</div>';
}

function vexa_render_faq(array $faqs): void
{
    echo '<div class="vexa-faq">';
    foreach ($faqs as $faq) {
        echo '<details class="vexa-faq__item">';
        echo '<summary>' . esc_html($faq['q']) . '</summary>';
        echo '<p>' . esc_html($faq['a']) . '</p>';
        echo '</details>';
    }
    echo '</div>';

    $faq_schema = [
        '@context' => 'https://schema.org',
        '@type' => 'FAQPage',
        'mainEntity' => array_map(static function (array $faq): array {
            return [
                '@type' => 'Question',
                'name' => $faq['q'],
                'acceptedAnswer' => [
                    '@type' => 'Answer',
                    'text' => $faq['a'],
                ],
            ];
        }, $faqs),
    ];
    echo '<script type="application/ld+json">' . wp_json_encode($faq_schema, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE) . '</script>';
}

function vexa_internal_link_cluster(string $context = 'general'): void
{
    $links = [
        ['Platform overview', home_url('/platform/'), 'See how catalog management, quality, approvals, and implementation planning fit together.'],
        ['Data quality and readiness', home_url('/platform/data-quality-readiness/'), 'Review completeness, validation, taxonomy, media, and approval readiness.'],
        ['PIM vs spreadsheets', home_url('/resources/pim-vs-spreadsheets/'), 'Compare governed product-data workflows with spreadsheet-based catalog operations.'],
        ['Plans', home_url('/plans/'), 'Review the right commercial path for your catalog stage.'],
    ];

    if ($context === 'integration') {
        $links[1] = ['Connector planning guide', home_url('/resources/connector-planning-guide/'), 'Prepare account, data, source-system, API, and workflow questions before implementation.'];
    }

    echo '<div class="internal-link-cluster" aria-label="Related Vexa PIM resources">';
    foreach ($links as $link) {
        echo '<a href="' . esc_url($link[1]) . '"><strong>' . esc_html($link[0]) . '</strong><span>' . esc_html($link[2]) . '</span></a>';
    }
    echo '</div>';
}

function vexa_platforms(): array
{
    return [
        'flipkart' => ['name' => 'Flipkart', 'type' => 'Marketplaces', 'use' => 'Catalog governance for marketplace selling teams.', 'workflow' => 'Prepare attributes, taxonomy, media, and review steps before platform-specific execution.'],
        'shopify' => ['name' => 'Shopify', 'type' => 'eCommerce platforms', 'use' => 'Product-data preparation for owned commerce storefronts.', 'workflow' => 'Organize core product records, merchandising content, media, and channel-ready fields.'],
        'myntra' => ['name' => 'Myntra', 'type' => 'Marketplaces', 'use' => 'Fashion and lifestyle catalog preparation.', 'workflow' => 'Structure category attributes, imagery, variants, and approval checkpoints for commercial planning.'],
        'amazon' => ['name' => 'Amazon', 'type' => 'Marketplaces', 'use' => 'Marketplace catalog planning for larger assortments.', 'workflow' => 'Review product data, taxonomy needs, media, and account requirements before implementation.'],
        'meesho' => ['name' => 'Meesho', 'type' => 'Marketplaces', 'use' => 'Marketplace product-data preparation for catalog teams.', 'workflow' => 'Clean product fields, organize media, and prepare data for your operating workflow.'],
        'nykaa' => ['name' => 'Nykaa', 'type' => 'Retail systems', 'use' => 'Beauty, personal care, and lifestyle catalog readiness.', 'workflow' => 'Review attributes, media, taxonomy, and approval needs before discussing implementation scope.'],
        'woocommerce' => ['name' => 'WooCommerce', 'type' => 'eCommerce platforms', 'use' => 'Product-data governance for WordPress commerce stores.', 'workflow' => 'Structure products, media, categories, and enrichment workflow for storefront planning.'],
        'custom-integrations' => ['name' => 'Custom Workflows', 'type' => 'Custom commerce workflows', 'use' => 'Planning for internal tools, ERPs, commerce stacks, or data pipelines.', 'workflow' => 'Map source systems, data requirements, governance rules, and implementation path.'],
    ];
}

function vexa_platform_display_name_from_current_post(): string
{
    $slug = get_post_field('post_name', get_queried_object_id());
    $platforms = vexa_platforms();
    if ($slug && isset($platforms[$slug]['name'])) {
        return $platforms[$slug]['name'];
    }

    return trim((string) preg_replace('/\s+Integration$/i', '', get_the_title()));
}

function vexa_platform_logo(string $slug, string $name = ''): string
{
    $platforms = vexa_platforms();
    $label = $name ?: ($platforms[$slug]['name'] ?? ucwords(str_replace('-', ' ', $slug)));
    $initials = vexa_platform_initials($slug, $label);
    $asset = vexa_platform_logo_asset($slug);
    $class = 'platform-logo platform-logo--' . sanitize_html_class($slug) . ($asset ? ' platform-logo--has-asset' : '');
    $mark = $asset
        ? '<span class="platform-logo__asset" aria-hidden="true"><img src="' . esc_url($asset) . '" alt=""></span>'
        : '<span class="platform-logo__mark" aria-hidden="true">' . vexa_platform_mark_svg($slug, $initials) . '</span>';
    $visible_label = $asset ? '' : '<b>' . esc_html($label) . '</b>';

    return '<span class="' . esc_attr($class) . '" role="img" aria-label="' . esc_attr($label . ' platform logo reference') . '">' . $mark . $visible_label . '</span>';
}

function vexa_platform_logo_asset(string $slug): string
{
    $assets = [
        'flipkart' => 'flipkart-logo.svg',
        'shopify' => 'shopify-logo.svg',
        'myntra' => 'myntra-logo.svg',
        'amazon' => 'amazon-logo.svg',
        'meesho' => 'meesho-logo.png',
        'nykaa' => 'nykaa-logo.svg',
        'woocommerce' => 'woocommerce-logo.svg',
    ];

    if (!isset($assets[$slug])) {
        return '';
    }

    return get_template_directory_uri() . '/assets/platforms/' . $assets[$slug];
}

function vexa_platform_initials(string $slug, string $label): string
{
    return [
        'flipkart' => 'F',
        'shopify' => 'S',
        'myntra' => 'M',
        'amazon' => 'A',
        'meesho' => 'Me',
        'nykaa' => 'N',
        'woocommerce' => 'W',
        'custom-integrations' => 'CW',
    ][$slug] ?? substr($label, 0, 2);
}

function vexa_platform_mark_svg(string $slug, string $initials = ''): string
{
    $initials = $initials ?: vexa_platform_initials($slug, ucwords(str_replace('-', ' ', $slug)));
    $safe_initials = esc_html($initials);
    $paths = [
        'flipkart' => '<rect x="8" y="7" width="20" height="22" rx="5"></rect><path d="M13 13h10"></path><path d="M13 18h7"></path>',
        'shopify' => '<path d="M13 9c0-3 1.7-5 4-5s4 2 4 5"></path><path d="M9 10h16l-2 20H11L9 10z"></path>',
        'myntra' => '<path d="M8 28V9l8 12 8-12v19"></path><path d="M16 21 12 28"></path><path d="M20 28l-4-7"></path>',
        'amazon' => '<path d="M9 21c5 5 14 5 19-1"></path><path d="m23 20 5 1-3 4"></path><path d="M11 12h14"></path>',
        'meesho' => '<circle cx="13" cy="14" r="5"></circle><circle cx="23" cy="22" r="5"></circle><path d="M17 17l3 3"></path>',
        'nykaa' => '<path d="M10 28V8l16 20V8"></path><path d="M10 8h6"></path><path d="M20 28h6"></path>',
        'woocommerce' => '<path d="M7 10h22v13H16l-5 5v-5H7z"></path><path d="M12 15l2 4 3-5 3 5 2-4"></path>',
        'custom-integrations' => '<path d="M10 13h7"></path><path d="M19 13h7"></path><path d="M17 13a2 2 0 1 0 4 0 2 2 0 0 0-4 0z"></path><path d="M9 24h7"></path><path d="M18 24h8"></path><path d="M16 24a2 2 0 1 0 4 0 2 2 0 0 0-4 0z"></path>',
    ][$slug] ?? '<text x="18" y="23" text-anchor="middle" font-size="10" font-weight="800" fill="currentColor">' . $safe_initials . '</text>';

    return '<svg viewBox="0 0 36 36" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' . $paths . '</svg>';
}

function vexa_logo_cloud(array $slugs = []): void
{
    $slugs = $slugs ?: array_keys(vexa_platforms());
    echo '<div class="logo-cloud">';
    foreach ($slugs as $slug) {
        echo vexa_platform_logo($slug);
    }
    echo '</div>';
}

function vexa_platform_groups(): array
{
    return [
        'Marketplaces' => ['flipkart', 'amazon', 'myntra', 'meesho'],
        'Storefronts' => ['shopify', 'woocommerce'],
        'Retail and category-led channels' => ['nykaa'],
        'Custom workflows' => ['custom-integrations'],
    ];
}

function vexa_platform_data_areas(string $slug): array
{
    $areas = [
        'shopify' => [
            ['Product identity', 'Titles, descriptions, handle planning, product type, vendor, and tags.'],
            ['Variant structure', 'Options, SKU structure, images by variant, and merchandising rules.'],
            ['Collections and taxonomy', 'Category logic, collections, navigation context, and storefront grouping.'],
            ['Storefront readiness', 'Media, SEO fields, metafield planning, and approval ownership.'],
        ],
        'woocommerce' => [
            ['Product model', 'Simple and variable product data, categories, tags, and attributes.'],
            ['Store content', 'Descriptions, image gallery, short copy, and merchandising fields.'],
            ['Operational fields', 'SKU, stock-related fields, shipping attributes, and ownership notes.'],
            ['Review workflow', 'Approval path before updates are discussed for storefront execution.'],
        ],
        'amazon' => [
            ['Catalog attributes', 'Core identifiers, variation family planning, category data, and brand fields.'],
            ['Content quality', 'Titles, bullet-style content, descriptions, images, and compliance context.'],
            ['Category readiness', 'Browse node or taxonomy questions, product type, and required fields.'],
            ['Account discussion', 'Account, team, and implementation needs to review privately.'],
        ],
        'flipkart' => [
            ['Listing data', 'Titles, product identifiers, category attributes, and variant context.'],
            ['Media and content', 'Images, descriptions, feature content, and review ownership.'],
            ['Category preparation', 'Taxonomy questions, required fields, and quality checks.'],
            ['Operational planning', 'Team workflow, account context, and implementation questions.'],
        ],
        'myntra' => [
            ['Fashion attributes', 'Size, color, fabric, fit, gender, season, and category-specific fields.'],
            ['Variant and imagery', 'Style grouping, size variants, image requirements, and media review.'],
            ['Merchandising content', 'Product story, care notes, material details, and approval context.'],
            ['Workflow planning', 'Reviewers, ownership, account context, and implementation questions.'],
        ],
        'meesho' => [
            ['Marketplace data', 'Product names, categories, variants, and seller-side field planning.'],
            ['Catalog cleanup', 'Descriptions, attributes, images, and duplicate-field review.'],
            ['Readiness checks', 'Completeness, consistency, and category-specific issue review.'],
            ['Team ownership', 'Who edits, reviews, approves, and prepares implementation questions.'],
        ],
        'nykaa' => [
            ['Beauty catalog fields', 'Ingredients, shade, skin type, usage notes, and category attributes.'],
            ['Media and compliance', 'Product images, claims context, labels, and approval review.'],
            ['Taxonomy readiness', 'Category placement, filters, attributes, and merchandising fields.'],
            ['Account planning', 'Commercial, account, and implementation questions for discussion.'],
        ],
        'custom-integrations' => [
            ['Source systems', 'ERPs, internal tools, files, APIs, and owners to review.'],
            ['Data model', 'Product, variant, media, taxonomy, and approval data requirements.'],
            ['Workflow logic', 'Review queues, approval rules, events, and operating responsibilities.'],
            ['Implementation path', 'Authentication, APIs, webhooks, data movement, and rollout questions.'],
        ],
    ];

    return $areas[$slug] ?? [
        ['Product identity', 'Titles, descriptions, categories, attributes, and ownership.'],
        ['Catalog readiness', 'Completeness, consistency, media, taxonomy, and review needs.'],
        ['Workflow ownership', 'Editors, reviewers, approvers, and implementation stakeholders.'],
        ['Implementation planning', 'Account context, data movement, and setup questions.'],
    ];
}

function vexa_integration_showcase_slider(string $active_slug = ''): void
{
    $slides = [
        [
            'slug' => 'marketplaces',
            'title' => 'Marketplace catalog readiness',
            'summary' => 'Prepare product records, attributes, media, taxonomy, and review ownership before marketplace-specific execution is discussed.',
            'logos' => ['flipkart', 'amazon', 'myntra', 'meesho'],
            'steps' => ['Source catalog', 'Attribute review', 'Media check', 'Approval path'],
        ],
        [
            'slug' => 'storefronts',
            'title' => 'Storefront product-data preparation',
            'summary' => 'Centralize product content, variants, categories, SEO fields, and media questions for owned commerce storefront discussions.',
            'logos' => ['shopify', 'woocommerce'],
            'steps' => ['Product model', 'Variant structure', 'Content enrichment', 'Storefront handoff'],
        ],
        [
            'slug' => 'retail',
            'title' => 'Retail and category-led channel review',
            'summary' => 'Review category attributes, compliance context, media requirements, and approval responsibilities for specialized retail workflows.',
            'logos' => ['nykaa'],
            'steps' => ['Category fields', 'Media review', 'Compliance context', 'Commercial discussion'],
        ],
        [
            'slug' => 'custom',
            'title' => 'Custom commerce workflow planning',
            'summary' => 'Map internal systems, catalog rules, approvals, APIs, and webhook questions before implementation scope is confirmed.',
            'logos' => ['custom-integrations'],
            'steps' => ['Source systems', 'Data model', 'API planning', 'Workflow scope'],
        ],
    ];
    $active_index = 0;
    foreach ($slides as $index => $slide) {
        if ($active_slug && in_array($active_slug, $slide['logos'], true)) {
            $active_index = $index;
            break;
        }
    }

    echo '<div class="ecosystem-slider js-vexa-slider" data-active="' . esc_attr($active_slug) . '" aria-label="Commerce ecosystem slideshow">';
    echo '<div class="ecosystem-slider__tabs" role="tablist" aria-label="Commerce workflow categories">';
    foreach ($slides as $index => $slide) {
        echo '<button type="button" class="ecosystem-slider__tab' . ($index === $active_index ? ' is-active' : '') . '" role="tab" aria-selected="' . ($index === $active_index ? 'true' : 'false') . '" aria-controls="ecosystem-slide-' . esc_attr($slide['slug']) . '" data-slide="' . esc_attr((string) $index) . '">' . esc_html($slide['title']) . '</button>';
    }
    echo '</div><div class="ecosystem-slider__viewport">';
    foreach ($slides as $index => $slide) {
        echo '<article id="ecosystem-slide-' . esc_attr($slide['slug']) . '" class="ecosystem-slide' . ($index === $active_index ? ' is-active' : '') . '" data-slide-panel="' . esc_attr((string) $index) . '" role="tabpanel">';
        echo '<div class="ecosystem-slide__copy"><p class="eyebrow">Workflow showcase</p><h3>' . esc_html($slide['title']) . '</h3><p>' . esc_html($slide['summary']) . '</p><div class="ecosystem-slide__logos">';
        foreach ($slide['logos'] as $slug) {
            echo vexa_platform_logo($slug);
        }
        echo '</div></div><div class="ecosystem-slide__visual" role="img" aria-label="' . esc_attr($slide['title'] . ' visual workflow') . '">';
        echo '<div class="ecosystem-slide__vexa"><img src="' . esc_url(get_template_directory_uri() . '/assets/brand/app_icon.svg') . '" alt="" aria-hidden="true"><strong>Vexa PIM</strong><span>governed catalog</span></div>';
        echo '<ol>';
        foreach ($slide['steps'] as $step) {
            [$icon, $description] = vexa_workflow_step_meta($step);
            echo '<li><span class="workflow-icon">' . vexa_icon_svg($icon) . '</span><strong>' . esc_html($step) . '</strong><em>' . esc_html($description) . '</em></li>';
        }
        echo '</ol></div></article>';
    }
    echo '</div></div>';
}

function vexa_logo_group_wall(): void
{
    echo '<div class="logo-group-wall" aria-label="Commerce platform logo groups">';
    foreach (vexa_platform_groups() as $label => $slugs) {
        echo '<section class="logo-group-wall__group"><h3>' . esc_html($label) . '</h3>';
        vexa_logo_cloud($slugs);
        echo '</section>';
    }
    echo '</div>';
}

function vexa_platform_field_board(string $slug, string $name): void
{
    $areas = vexa_platform_data_areas($slug);
    echo '<div class="field-board" aria-label="' . esc_attr($name . ' product-data preparation areas') . '">';
    echo '<div class="field-board__preview">';
    echo '<div class="app-window"><div class="app-window__bar"><i></i><i></i><i></i><strong>Vexa PIM</strong></div>';
    echo '<div class="app-window__body"><aside><img src="' . esc_url(get_template_directory_uri() . '/assets/brand/app_icon.svg') . '" alt="" aria-hidden="true"><span></span><span></span><span></span></aside><main>';
    echo '<div class="app-window__header"><small>' . esc_html(vexa_platform_initials($slug, $name)) . '</small><b>' . esc_html($name . ' preparation board') . '</b></div>';
    echo '<div class="app-window__chips"><em>Attributes</em><em>Media</em><em>Ownership</em><em>Planning</em></div><div class="app-window__rows">';
    foreach (array_slice($areas, 0, 3) as $area) {
        echo '<span><b>' . esc_html($area[0]) . '</b><i></i></span>';
    }
    echo '</div></main></div></div></div>';
    echo '<div class="field-board__cards">';
    foreach ($areas as $index => $area) {
        [$icon] = vexa_workflow_step_meta($area[0]);
        echo '<article><span class="workflow-icon">' . vexa_icon_svg($icon) . '</span><strong>' . esc_html($area[0]) . '</strong><p>' . esc_html($area[1]) . '</p></article>';
    }
    echo '</div></div>';
}

function vexa_icon_svg(string $icon): string
{
    $paths = [
        'upload' => '<path d="M12 3v12"></path><path d="m7 8 5-5 5 5"></path><path d="M5 15v4h14v-4"></path>',
        'map' => '<path d="M8 6h8"></path><path d="M8 12h8"></path><path d="M8 18h8"></path><path d="M4 6h.01"></path><path d="M4 12h.01"></path><path d="M4 18h.01"></path>',
        'review' => '<path d="M9 5h6"></path><path d="M9 3h6v4H9z"></path><path d="M8 14l2 2 4-5"></path><path d="M6 5H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-1"></path>',
        'warning' => '<path d="M12 9v4"></path><path d="M12 17h.01"></path><path d="M10.3 4.3 2.8 17.5A2 2 0 0 0 4.5 20h15a2 2 0 0 0 1.7-2.5L13.7 4.3a2 2 0 0 0-3.4 0z"></path>',
        'approve' => '<path d="M20 6 9 17l-5-5"></path><path d="M21 12a9 9 0 1 1-5.3-8.2"></path>',
        'people' => '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path><path d="M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z"></path><path d="M22 21v-2a4 4 0 0 0-3-3.9"></path><path d="M16 3.1a4 4 0 0 1 0 7.8"></path>',
        'shield' => '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path><path d="m9 12 2 2 4-4"></path>',
        'inbox' => '<path d="M22 12h-6l-2 3h-4l-2-3H2"></path><path d="m5.5 5.1-3.5 7V19a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6.9l-3.5-7A2 2 0 0 0 16.7 4H7.3a2 2 0 0 0-1.8 1.1z"></path>',
        'history' => '<path d="M3 12a9 9 0 1 0 3-6.7"></path><path d="M3 3v6h6"></path><path d="M12 7v5l3 2"></path>',
        'lock' => '<rect x="4" y="11" width="16" height="10" rx="2"></rect><path d="M8 11V7a4 4 0 0 1 8 0v4"></path>',
        'database' => '<ellipse cx="12" cy="5" rx="8" ry="3"></ellipse><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5"></path><path d="M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"></path>',
        'api' => '<path d="m8 9-4 3 4 3"></path><path d="m16 9 4 3-4 3"></path><path d="m14 4-4 16"></path>',
        'catalog' => '<path d="M4 4h16v16H4z"></path><path d="M8 4v16"></path><path d="M4 9h16"></path><path d="M4 14h16"></path>',
        'webhook' => '<path d="M18 16.5a3 3 0 1 0 2.6 1.5"></path><path d="M6 7.5a3 3 0 1 0-2.6-1.5"></path><path d="M6 16.5a3 3 0 1 0-2.6 1.5"></path><path d="M8.6 6.5h6.8L12 12l3.4 5.5H8.6"></path>',
        'destination' => '<path d="M12 21s7-5.3 7-11a7 7 0 1 0-14 0c0 5.7 7 11 7 11z"></path><circle cx="12" cy="10" r="2"></circle>',
        'edit' => '<path d="M12 20h9"></path><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"></path>',
        'validate' => '<path d="M20 7 9 18l-5-5"></path><path d="M4 7V4h16v8"></path>',
        'send' => '<path d="m22 2-7 20-4-9-9-4 20-7z"></path><path d="M22 2 11 13"></path>',
        'box' => '<path d="m21 8-9-5-9 5 9 5 9-5z"></path><path d="M3 8v8l9 5 9-5V8"></path><path d="M12 13v8"></path>',
    ];

    $path = $paths[$icon] ?? $paths['box'];
    return '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' . $path . '</svg>';
}

function vexa_workflow_step_meta(string $step): array
{
    $meta = [
        'Import' => ['upload', 'Bring source product records into Vexa.'],
        'Enrich' => ['edit', 'Improve titles, attributes, taxonomy, and media.'],
        'Validate' => ['validate', 'Check completeness and readiness rules.'],
        'Approve' => ['approve', 'Confirm reviewed data before handoff.'],
        'Prepare' => ['box', 'Package data for commerce planning.'],
        'Discuss channel execution' => ['send', 'Clarify the right implementation path.'],
        'Model' => ['catalog', 'Define product structure and data areas.'],
        'Review' => ['review', 'Route records through quality review.'],
        'Sources' => ['database', 'Identify source files, systems, and owners.'],
        'Vexa PIM' => ['catalog', 'Centralize governed product records.'],
        'Approval' => ['approve', 'Confirm ownership and readiness.'],
        'Execution planning' => ['send', 'Prepare the next commercial or technical step.'],
        'Product workbench' => ['catalog', 'Walk through governed catalog operations.'],
        'Quality checks' => ['validate', 'Review completeness and consistency.'],
        'Workflow approvals' => ['people', 'Show review and approval ownership.'],
        'Commerce-channel planning' => ['send', 'Discuss platform and workflow needs.'],
        'API and webhooks' => ['api', 'Frame technical data movement.'],
        'Files and systems' => ['database', 'Identify source inputs and systems.'],
        'Vexa governed catalog' => ['catalog', 'Centralize product truth before handoff.'],
        'Quality review' => ['validate', 'Find issues before downstream work.'],
        'Team approval' => ['people', 'Coordinate reviewers and approvers.'],
        'Commerce preparation' => ['send', 'Prepare channel requirements.'],
        'Upload catalog data' => ['upload', 'Select and stage product records.'],
        'Map fields' => ['map', 'Match source fields to Vexa structure.'],
        'Review changes' => ['review', 'Compare updates before committing.'],
        'Resolve issues' => ['warning', 'Fix warnings and incomplete data.'],
        'Approve import' => ['approve', 'Confirm the governed catalog update.'],
        'Source system' => ['database', 'Identify where product data starts.'],
        'API request' => ['api', 'Plan authenticated data movement.'],
        'Vexa catalog event' => ['catalog', 'Capture governed product changes.'],
        'Webhook planning' => ['webhook', 'Define event triggers and payload needs.'],
        'Downstream workflow' => ['destination', 'Prepare receiving systems and teams.'],
        'Spreadsheet copies' => ['catalog', 'Scattered files create version drift.'],
        'Missing context' => ['warning', 'Important ownership and quality details get lost.'],
        'Vexa governed catalog' => ['catalog', 'Centralize product truth before review.'],
        'Review workflow' => ['review', 'Move changes through governed review.'],
        'Prepared handoff' => ['send', 'Prepare cleaner data for commerce work.'],
        'Find issue' => ['warning', 'Spot incomplete or inconsistent fields.'],
        'Assign owner' => ['people', 'Route the fix to the right person.'],
        'Fix data' => ['edit', 'Update content, attributes, media, or taxonomy.'],
        'Review quality' => ['validate', 'Check the corrected product record.'],
        'Approve readiness' => ['approve', 'Confirm the data is ready for handoff.'],
        'Centralize product records' => ['catalog', 'Create one governed place for product truth.'],
        'Improve data quality' => ['validate', 'Review completeness, consistency, and media needs.'],
        'Coordinate ownership and approvals' => ['people', 'Clarify who edits, reviews, and approves.'],
        'Prepare channel-ready product information' => ['send', 'Package cleaner data for commerce planning.'],
        'Single source of product truth' => ['catalog', 'Reduce version drift across teams and files.'],
        'Validation and readiness checks' => ['validate', 'Find missing or inconsistent data earlier.'],
        'Approval workflows' => ['approve', 'Move records through controlled review.'],
        'Audit-friendly collaboration' => ['history', 'Keep ownership and decision context visible.'],
        'Required attributes' => ['map', 'Confirm key product and category fields.'],
        'Media quality' => ['review', 'Review image and asset readiness.'],
        'Taxonomy alignment' => ['catalog', 'Match products to the right category structure.'],
        'Approval completion' => ['approve', 'Confirm review before next steps.'],
        'Completeness' => ['validate', 'Confirm required data is present.'],
        'Consistency' => ['map', 'Standardize values and naming patterns.'],
        'Accuracy' => ['review', 'Review product details before handoff.'],
        'Governance' => ['shield', 'Clarify owners, controls, and decisions.'],
        'Readiness' => ['approve', 'Prepare data for the next workflow.'],
        'Account requirements' => ['lock', 'Clarify platform and access prerequisites.'],
        'Data requirements' => ['map', 'Document product fields and data areas.'],
        'Workflow needs' => ['people', 'Align owners, reviewers, and approvals.'],
        'Implementation discussion' => ['send', 'Prepare questions for the Vexa team.'],
        'Product records' => ['catalog', 'Model the core product information.'],
        'Variant structure' => ['box', 'Keep variants organized with products.'],
        'Media library' => ['review', 'Connect assets to catalog readiness.'],
        'Taxonomy model' => ['map', 'Structure category and attribute logic.'],
        'Media review' => ['review', 'Check images and supporting assets.'],
        'Readiness checks' => ['validate', 'Spot gaps before handoff.'],
        'Editor queue' => ['edit', 'Stage product changes for review.'],
        'Reviewer context' => ['review', 'Give reviewers the product details they need.'],
        'Approval ownership' => ['approve', 'Clarify who confirms readiness.'],
        'Audit trail' => ['history', 'Preserve decision and change context.'],
        'Account context' => ['lock', 'Review account and onboarding needs.'],
        'Data mapping' => ['map', 'Align source fields with Vexa structure.'],
        'Workflow planning' => ['people', 'Plan owners, queues, and approvals.'],
        'Implementation scope' => ['send', 'Frame the right implementation path.'],
        'API access' => ['api', 'Plan authenticated technical access.'],
        'Event planning' => ['webhook', 'Define events and triggers.'],
        'Source systems' => ['database', 'Identify systems that hold product data.'],
        'Technical ownership' => ['people', 'Assign implementation responsibility.'],
        'Role access' => ['people', 'Review role-based access needs.'],
        'Workflow control' => ['shield', 'Control review and approval paths.'],
        'Account review' => ['lock', 'Prepare account-level questions.'],
        'Marketplace teams' => ['send', 'Prepare commerce-channel workflows.'],
        'Catalog managers' => ['catalog', 'Own product records and readiness.'],
        'eCommerce leaders' => ['review', 'Track readiness and team progress.'],
        'Technical teams' => ['api', 'Clarify data movement and system needs.'],
        'Channel preparation' => ['send', 'Prepare product data for channel discussions.'],
        'Catalog blockers' => ['warning', 'Surface issues before downstream work.'],
        'Review ownership' => ['people', 'Assign review responsibilities.'],
        'Implementation questions' => ['lock', 'Collect scope and setup questions.'],
        'Attribute quality' => ['validate', 'Improve required product attributes.'],
        'Variant control' => ['box', 'Keep SKU and variant structure clear.'],
        'Media readiness' => ['review', 'Review images and assets before handoff.'],
        'Approval clarity' => ['approve', 'Make decision ownership explicit.'],
        'Operational visibility' => ['review', 'See catalog work and quality signals.'],
        'Team accountability' => ['people', 'Clarify owners across the workflow.'],
        'Readiness trends' => ['validate', 'Monitor quality and completion signals.'],
        'Commercial planning' => ['send', 'Prepare business discussion paths.'],
        'Data movement' => ['api', 'Plan how product data travels.'],
        'API planning' => ['api', 'Frame API requirements and access.'],
        'Webhook events' => ['webhook', 'Plan event-driven updates.'],
        'Terms review' => ['review', 'Route commercial review questions.'],
        'Privacy questions' => ['lock', 'Prepare privacy and data questions.'],
        'Data processing' => ['database', 'Clarify processing context.'],
        'Security review' => ['shield', 'Review safeguards and responsibilities.'],
        'Commercial terms' => ['review', 'Clarify buying and agreement context.'],
        'Account usage' => ['people', 'Frame account responsibilities.'],
        'Customer responsibilities' => ['people', 'Confirm customer-side ownership.'],
        'Agreement review' => ['history', 'Preserve legal review context.'],
        'Contact information' => ['inbox', 'Route business contact requests.'],
        'Demo requests' => ['send', 'Prepare sales and demo follow-up.'],
        'Sales communication' => ['inbox', 'Route commercial enquiries.'],
        'Processing scope' => ['database', 'Clarify data-processing boundaries.'],
        'Subprocessor questions' => ['shield', 'Review vendor and security questions.'],
        'Implementation context' => ['send', 'Frame onboarding needs.'],
        'PIM foundations' => ['catalog', 'Understand governed product information.'],
        'Spreadsheet replacement' => ['edit', 'Move repeated cleanup out of files.'],
        'Listing readiness' => ['validate', 'Prepare data before commerce work.'],
        'Product-data quality' => ['review', 'Improve completeness and consistency.'],
        'Connector planning' => ['api', 'Plan integration requirements privately.'],
        'Source catalog' => ['database', 'Start from existing product records and source context.'],
        'Data enrichment' => ['edit', 'Improve copy, attributes, taxonomy, media notes, and merchandising context.'],
        'Validation review' => ['validate', 'Check completeness, consistency, and readiness signals before handoff.'],
        'Platform-specific preparation' => ['send', 'Package approved product data and questions for workflow discussion.'],
        'Attribute review' => ['map', 'Check required fields and category-specific values.'],
        'Media check' => ['review', 'Review images and assets before downstream work.'],
        'Approval path' => ['approve', 'Clarify who signs off before execution discussion.'],
        'Product model' => ['catalog', 'Structure product, variant, and collection logic.'],
        'Storefront handoff' => ['send', 'Prepare product data for storefront workflow planning.'],
        'Category fields' => ['map', 'Review category, filter, and attribute requirements.'],
        'Compliance context' => ['shield', 'Capture claims, labels, and review questions.'],
        'Commercial discussion' => ['review', 'Bring account and business context into the demo.'],
        'Data model' => ['catalog', 'Document product records, variants, media, and taxonomy.'],
        'Workflow scope' => ['send', 'Frame owners, systems, and implementation boundaries.'],
        'Content enrichment' => ['edit', 'Improve product copy, images, category context, and merchandising fields.'],
        'Product identity' => ['catalog', 'Clarify names, descriptions, brand context, and ownership.'],
        'Collections and taxonomy' => ['map', 'Organize storefront grouping, collections, and category logic.'],
        'Storefront readiness' => ['validate', 'Review media, SEO, metafields, and approval needs.'],
        'Listing data' => ['catalog', 'Prepare core product identifiers and listing fields.'],
        'Media and content' => ['review', 'Review product images, copy, features, and merchandising context.'],
        'Category preparation' => ['map', 'Clarify taxonomy questions and required category fields.'],
        'Operational planning' => ['people', 'Align account context, owners, and implementation questions.'],
        'Catalog attributes' => ['map', 'Review identifiers, variation families, categories, and brand fields.'],
        'Content quality' => ['validate', 'Check product copy, images, completeness, and consistency.'],
        'Category readiness' => ['approve', 'Confirm taxonomy and required-field readiness.'],
        'Account discussion' => ['lock', 'Prepare account, team, and implementation needs.'],
        'Fashion attributes' => ['map', 'Review size, color, fabric, fit, season, and category-specific data.'],
        'Variant and imagery' => ['review', 'Plan style grouping, size variants, and media review.'],
        'Merchandising content' => ['edit', 'Prepare product story, care notes, material details, and approvals.'],
        'Marketplace data' => ['catalog', 'Review marketplace product names, variants, and category fields.'],
        'Catalog cleanup' => ['warning', 'Find duplicate, missing, or inconsistent product data.'],
        'Beauty catalog fields' => ['map', 'Prepare ingredients, shade, usage, and category attributes.'],
        'Media and compliance' => ['shield', 'Review images, claims context, labels, and approval questions.'],
        'Taxonomy readiness' => ['approve', 'Confirm filters, categories, and merchandising fields.'],
        'Account planning' => ['lock', 'Prepare commercial, account, and implementation questions.'],
        'Workflow logic' => ['webhook', 'Review queues, approval rules, events, and responsibilities.'],
        'Implementation path' => ['send', 'Frame authentication, APIs, webhooks, and rollout questions.'],
    ];

    return $meta[$step] ?? ['box', 'Keep this product-data step visible to the team.'];
}

function vexa_workflow_step_class(string $step): string
{
    $key_steps = ['Resolve issues', 'Validate', 'Quality checks', 'Quality review', 'Vexa governed catalog', 'Vexa catalog event'];
    return in_array($step, $key_steps, true) ? ' class="is-key-step"' : '';
}

function vexa_infographic_title_icon(string $title): string
{
    $title_lower = strtolower($title);

    if (str_contains($title_lower, 'bulk import')) {
        return 'upload';
    }

    if (str_contains($title_lower, 'api') || str_contains($title_lower, 'webhook')) {
        return 'api';
    }

    if (str_contains($title_lower, 'security') || str_contains($title_lower, 'governance')) {
        return 'shield';
    }

    if (str_contains($title_lower, 'spreadsheet')) {
        return 'edit';
    }

    if (str_contains($title_lower, 'quality') || str_contains($title_lower, 'readiness')) {
        return 'validate';
    }

    if (str_contains($title_lower, 'demo')) {
        return 'review';
    }

    if (str_contains($title_lower, 'source') || str_contains($title_lower, 'operating')) {
        return 'database';
    }

    return 'catalog';
}

function vexa_workflow_infographic(array $steps, string $title, string $summary = ''): void
{
    echo '<div class="infographic" role="img" aria-label="' . esc_attr($title . '. ' . implode(' to ', $steps)) . '">';
    echo '<div class="infographic__header"><span class="infographic__header-icon workflow-icon">' . vexa_icon_svg(vexa_infographic_title_icon($title)) . '</span><div><h3>' . esc_html($title) . '</h3>';
    if ($summary) {
        echo '<p>' . esc_html($summary) . '</p>';
    }
    echo '</div></div><ol class="workflow-diagram workflow-diagram--sequence">';
    foreach ($steps as $step) {
        [$icon, $description] = vexa_workflow_step_meta($step);
        echo '<li' . vexa_workflow_step_class($step) . '><span class="workflow-icon">' . vexa_icon_svg($icon) . '</span><strong>' . esc_html($step) . '</strong><em>' . esc_html($description) . '</em></li>';
    }
    echo '</ol></div>';
}

function vexa_catalog_workflow_infographic(): void
{
    vexa_workflow_infographic(
        ['Import', 'Enrich', 'Validate', 'Approve', 'Prepare', 'Discuss channel execution'],
        'Homepage catalog workflow',
        'A preflight-first path from messy product records to commerce-channel planning.'
    );
}

function vexa_lifecycle_infographic(): void
{
    vexa_workflow_infographic(
        ['Model', 'Enrich', 'Validate', 'Review', 'Approve', 'Prepare'],
        'Product-data lifecycle',
        'Govern attributes, media, taxonomy, compliance fields, and channel-specific data areas.'
    );
}

function vexa_ecosystem_infographic(): void
{
    echo '<div class="ecosystem-map" role="img" aria-label="Vexa PIM commerce ecosystem overview with marketplaces, ecommerce platforms, retail systems, and custom commerce workflows.">';
    echo '<div class="ecosystem-map__center"><img src="' . esc_url(get_template_directory_uri() . '/assets/brand/app_icon.svg') . '" alt="" aria-hidden="true"><strong>Vexa governed catalog</strong></div>';
    echo '<div class="ecosystem-map__logos">';
    vexa_logo_cloud();
    echo '</div></div>';
}

function vexa_plans_infographic(): void
{
    $plans = [
        ['Trial', 'Evaluate Vexa with a focused sample catalog'],
        ['Starter', 'For small catalogs and early catalog governance'],
        ['Growth', 'For growing product teams managing more products and workflows'],
        ['Business', 'For high-volume operations and multi-team governance'],
        ['Enterprise', 'For complex requirements and commercial terms'],
    ];
    echo '<div class="plan-spectrum" role="img" aria-label="Vexa plan comparison from evaluation to enterprise catalog operations.">';
    foreach ($plans as $plan) {
        echo '<article><strong>' . esc_html($plan[0]) . '</strong><span>' . esc_html($plan[1]) . '</span></article>';
    }
    echo '</div>';
}

function vexa_demo_agenda_infographic(): void
{
    vexa_workflow_infographic(
        ['Product workbench', 'Quality checks', 'Workflow approvals', 'Commerce-channel planning', 'API and webhooks'],
        '30-minute demo agenda',
        'A focused session shaped around your catalog, team, and implementation questions.'
    );
}

function vexa_source_to_commerce_infographic(): void
{
    vexa_workflow_infographic(
        ['Files and systems', 'Vexa governed catalog', 'Quality review', 'Team approval', 'Commerce preparation'],
        'Source-to-PIM-to-commerce architecture',
        'A planning view of how product data moves from source inputs into a governed Vexa workspace before commerce-channel execution.'
    );
}

function vexa_bulk_preflight_infographic(): void
{
    vexa_workflow_infographic(
        ['Upload catalog data', 'Map fields', 'Review changes', 'Resolve issues', 'Approve import'],
        'Bulk import and preflight',
        'Review larger product-data changes before they affect governed catalog records.'
    );
}

function vexa_security_governance_infographic(): void
{
    $items = [
        ['Roles', 'people', 'Define user ownership and team responsibilities.'],
        ['Permissions', 'shield', 'Review access boundaries before onboarding.'],
        ['Review queues', 'inbox', 'Route catalog work to the right reviewers.'],
        ['Approval history', 'history', 'Keep decision context visible for audits.'],
        ['Security questions', 'lock', 'Prepare controls for implementation review.'],
    ];

    echo '<div class="infographic infographic--capabilities" role="img" aria-label="Security and governance review. Roles, permissions, review queues, approval history, and security questions.">';
    echo '<div class="infographic__header"><span class="infographic__header-icon workflow-icon">' . vexa_icon_svg('shield') . '</span><div><h3>Security and governance review</h3><p>A commercial-evaluation view of the controls teams should review before production onboarding.</p></div></div>';
    echo '<div class="capability-diagram">';
    foreach ($items as $item) {
        echo '<article class="capability-diagram__card"><span class="workflow-icon">' . vexa_icon_svg($item[1]) . '</span><strong>' . esc_html($item[0]) . '</strong><em>' . esc_html($item[2]) . '</em></article>';
    }
    echo '</div></div>';
}

function vexa_api_webhook_infographic(): void
{
    vexa_workflow_infographic(
        ['Source system', 'API request', 'Vexa catalog event', 'Webhook planning', 'Downstream workflow'],
        'API and webhook data flow',
        'A technical planning view for data movement, events, and implementation ownership.'
    );
}

function vexa_product_proof_gallery(): void
{
    $items = [
        ['Dashboard', 'See catalog readiness, review queues, and priority product-data work.'],
        ['Product detail', 'Review attributes, taxonomy, media notes, and ownership context.'],
        ['Variants and SKUs', 'Keep variant structure visible while avoiding scattered spreadsheet copies.'],
        ['Media governance', 'Track image and asset readiness as part of the catalog workflow.'],
        ['Completeness checks', 'Surface missing or inconsistent product data before handoff.'],
        ['Approval workflow', 'Separate editor, reviewer, approver, and technical planning responsibilities.'],
        ['Mapping workspace', 'Plan field mapping and source-system questions before implementation.'],
        ['API and webhooks', 'Frame technical integration needs with product-data context.'],
    ];

    echo '<div class="proof-gallery" aria-label="Vexa product walkthrough gallery with demo-safe app page examples.">';
    foreach ($items as $index => $item) {
        echo '<article class="proof-shot">';
        echo '<div class="proof-shot__screen" role="img" aria-label="' . esc_attr('Demo-safe Vexa app view: ' . $item[0]) . '">';
        echo '<div class="proof-shot__bar"><span></span><span></span><span></span><strong>' . esc_html($item[0]) . '</strong></div>';
        echo '<div class="proof-shot__body"><aside><i></i><i></i><i></i></aside><main>';
        echo '<b>' . esc_html(sprintf('%02d', $index + 1)) . '</b><h3>' . esc_html($item[0]) . '</h3>';
        echo '<p>' . esc_html($item[1]) . '</p>';
        echo '<div><span></span><span></span><span></span></div>';
        echo '</main></div></div>';
        echo '</article>';
    }
    echo '</div>';
}

function vexa_about_product_snapshots(): void
{
    $items = [
        ['Catalog dashboard', 'Track catalog readiness, review work, and product-data priorities.'],
        ['Product detail page', 'Review attributes, taxonomy, media context, and ownership in one place.'],
        ['Quality review', 'Surface missing fields, weak media, and inconsistent values before handoff.'],
        ['Approval workflow', 'Separate editing, review, approval, and implementation planning responsibilities.'],
    ];

    echo '<div class="proof-gallery proof-gallery--compact" aria-label="Demo-safe Vexa app page snapshots for catalog dashboard, product detail, quality review, and approval workflow.">';
    foreach ($items as $index => $item) {
        echo '<article class="proof-shot">';
        echo '<div class="proof-shot__screen" role="img" aria-label="' . esc_attr('Vexa product snapshot: ' . $item[0]) . '">';
        echo '<div class="proof-shot__bar"><span></span><span></span><span></span><strong>Vexa PIM</strong></div>';
        echo '<div class="proof-shot__body"><aside><i></i><i></i><i></i></aside><main>';
        echo '<b>' . esc_html(sprintf('%02d', $index + 1)) . '</b><h3>' . esc_html($item[0]) . '</h3>';
        echo '<p>' . esc_html($item[1]) . '</p>';
        echo '<div><span></span><span></span><span></span></div>';
        echo '</main></div></div>';
        echo '</article>';
    }
    echo '</div>';
}

function vexa_product_flow_showcase(): void
{
    $screens = [
        [
            'number' => '01',
            'title' => 'Catalog workbench',
            'summary' => 'Bring products, variants, brands, media, and ownership into one governed catalog view.',
            'items' => ['Cotton kurta set', 'Wireless earbuds', 'Dining chair'],
            'meta' => ['Attributes', 'Variants', 'Owner'],
            'accent' => 'catalog',
        ],
        [
            'number' => '02',
            'title' => 'Enrichment page',
            'summary' => 'Improve titles, descriptions, taxonomy, attributes, images, and merchandising fields before review.',
            'items' => ['Title and description', 'Category attributes', 'Image and media notes'],
            'meta' => ['Content', 'Taxonomy', 'Media'],
            'accent' => 'enrich',
        ],
        [
            'number' => '03',
            'title' => 'Quality checks',
            'summary' => 'Find missing fields, inconsistent values, weak media, and category-specific issues earlier.',
            'items' => ['Missing dimensions', 'Media needs review', 'Attribute value mismatch'],
            'meta' => ['Completeness', 'Consistency', 'Readiness'],
            'accent' => 'quality',
        ],
        [
            'number' => '04',
            'title' => 'Workflow approvals',
            'summary' => 'Move product records through editor, reviewer, approver, and technical planning steps.',
            'items' => ['Editor changes', 'Reviewer comments', 'Approval decision'],
            'meta' => ['Editor', 'Reviewer', 'Approver'],
            'accent' => 'workflow',
        ],
        [
            'number' => '05',
            'title' => 'Commerce preparation',
            'summary' => 'Prepare structured product data for marketplace, storefront, retail, or custom implementation discussions.',
            'items' => ['Channel fields', 'Setup questions', 'Implementation notes'],
            'meta' => ['Marketplaces', 'Storefronts', 'Custom'],
            'accent' => 'prepare',
        ],
    ];

    echo '<div class="product-flow-showcase" aria-label="Vexa product flow showing catalog workbench, enrichment, quality checks, approvals, and commerce preparation.">';
    echo '<div class="product-flow-showcase__rail" aria-hidden="true"><img src="' . esc_url(get_template_directory_uri() . '/assets/brand/app_icon.svg') . '" alt=""><span></span><span></span><span></span><span></span><span></span></div>';
    foreach ($screens as $screen) {
        echo '<article class="app-screen-card app-screen-card--' . esc_attr($screen['accent']) . '">';
        echo '<div class="app-screen-card__copy"><span>' . esc_html($screen['number']) . '</span><h3>' . esc_html($screen['title']) . '</h3><p>' . esc_html($screen['summary']) . '</p></div>';
        echo '<figure class="app-screen-card__visual" role="img" aria-label="' . esc_attr('Vexa app screen for ' . $screen['title']) . '">';
        echo '<div class="app-window"><div class="app-window__bar"><i></i><i></i><i></i><strong>Vexa PIM</strong></div>';
        echo '<div class="app-window__body"><aside><img src="' . esc_url(get_template_directory_uri() . '/assets/brand/app_icon.svg') . '" alt="" aria-hidden="true"><span></span><span></span><span></span></aside><main>';
        echo '<div class="app-window__header"><small>' . esc_html($screen['number']) . '</small><b>' . esc_html($screen['title']) . '</b></div>';
        echo '<div class="app-window__chips">';
        foreach ($screen['meta'] as $meta) {
            echo '<em>' . esc_html($meta) . '</em>';
        }
        echo '</div><div class="app-window__rows">';
        foreach ($screen['items'] as $item) {
            echo '<span><b>' . esc_html($item) . '</b><i></i></span>';
        }
        echo '</div></main></div></div>';
        echo '</figure></article>';
    }
    echo '</div>';
}

function vexa_disclaimer(): void
{
    echo '<p class="disclaimer">Integration scope and availability depend on your platform account, required capabilities and implementation needs. Contact Vexa to discuss your requirements.</p>';
}
