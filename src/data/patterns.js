/**
 * Design pattern node maps — concrete CraftJS recipes for add_custom_section.
 * Each pattern is { description, usage, nodes }.
 */

module.exports = {
  'bento-gallery': {
    description: 'Asymmetric photo grid — 2 landscape images on top, 1 tall portrait + 1 info card on bottom. Creates visual interest without masonry JS. Great for "The Space", gallery, or portfolio sections.',
    usage: 'Change image URLs, alt text, card content. Adjust grid ratios with gridCols and row spans.',
    nodes: {
      sec_gallery: {
        type: { resolvedName: 'Container' }, isCanvas: true,
        props: { canDelete: true, canEditName: true, type: 'section',
          root: { background: 'bg-(--ph-alternate-background)' },
          mobile: { display: 'flex', flexDirection: 'flex-col', width: 'w-full', py: 'py-16', px: 'px-(--ph-container-padding-x)' },
          desktop: { py: 'py-24' },
          custom: { displayName: 'Gallery Section' } },
        displayName: 'Container', parent: 'page_home', nodes: ['gallery_header', 'gallery_grid'], linkedNodes: {}
      },
      gallery_header: {
        type: { resolvedName: 'Container' }, isCanvas: true,
        props: { canDelete: true, canEditName: true, root: {},
          mobile: { display: 'flex', flexDirection: 'flex-col', alignItems: 'items-center', gap: 'gap-2', width: 'w-full', maxWidth: 'max-w-(--ph-content-width)', mx: 'mx-auto', mb: 'mb-12' },
          desktop: {},
          custom: { displayName: 'Gallery Header' } },
        displayName: 'Container', parent: 'sec_gallery', nodes: ['gallery_eyebrow', 'gallery_title'], linkedNodes: {}
      },
      gallery_eyebrow: {
        type: { resolvedName: 'Text' }, isCanvas: false,
        props: { canDelete: true, canEditName: true,
          root: { color: 'text-(--ph-accent)', fontFamily: 'var(--ph-body-font-family)' },
          mobile: { fontSize: 'text-xs', fontWeight: 'font-bold', letterSpacing: 'tracking-widest', textAlign: 'text-center' },
          desktop: {}, text: 'EXPERIENCE \u00b7 EXPLORE', tagName: 'p',
          custom: { displayName: 'Eyebrow' } },
        displayName: 'Text', parent: 'gallery_header', nodes: [], linkedNodes: {}
      },
      gallery_title: {
        type: { resolvedName: 'Text' }, isCanvas: false,
        props: { canDelete: true, canEditName: true,
          root: { color: 'text-(--ph-primary)', fontFamily: 'var(--ph-heading-font-family)' },
          mobile: { fontSize: 'text-3xl', fontWeight: 'font-bold', textAlign: 'text-center' },
          desktop: { fontSize: 'text-4xl' }, text: 'The Space', tagName: 'h2',
          custom: { displayName: 'Title' } },
        displayName: 'Text', parent: 'gallery_header', nodes: [], linkedNodes: {}
      },
      gallery_grid: {
        type: { resolvedName: 'Container' }, isCanvas: true,
        props: { canDelete: true, canEditName: true, root: {},
          mobile: { display: 'grid', gridCols: 'grid-cols-1', gap: 'gap-4', width: 'w-full', maxWidth: 'max-w-(--ph-content-width)', mx: 'mx-auto' },
          desktop: { gridCols: 'grid-cols-4' },
          custom: { displayName: 'Grid' } },
        displayName: 'Container', parent: 'sec_gallery', nodes: ['gallery_img1', 'gallery_img2', 'gallery_img3', 'gallery_card'], linkedNodes: {}
      },
      gallery_img1: {
        type: { resolvedName: 'Image' }, isCanvas: false,
        props: { canDelete: true, canEditName: true, type: 'url',
          content: 'https://images.unsplash.com/photo-1554118811-1e0d58224f24?w=600',
          alt: 'Interior view', root: { radius: 'rounded-(--ph-border-radius)' },
          mobile: { width: 'w-full', height: 'h-[250px]', objectFit: 'object-cover' },
          desktop: { height: 'h-[300px]', gridCols: 'col-span-2' },
          custom: { displayName: 'Photo 1' } },
        displayName: 'Image', parent: 'gallery_grid', nodes: [], linkedNodes: {}
      },
      gallery_img2: {
        type: { resolvedName: 'Image' }, isCanvas: false,
        props: { canDelete: true, canEditName: true, type: 'url',
          content: 'https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?w=600',
          alt: 'Detail shot', root: { radius: 'rounded-(--ph-border-radius)' },
          mobile: { width: 'w-full', height: 'h-[250px]', objectFit: 'object-cover' },
          desktop: { height: 'h-[300px]', gridCols: 'col-span-2' },
          custom: { displayName: 'Photo 2' } },
        displayName: 'Image', parent: 'gallery_grid', nodes: [], linkedNodes: {}
      },
      gallery_img3: {
        type: { resolvedName: 'Image' }, isCanvas: false,
        props: { canDelete: true, canEditName: true, type: 'url',
          content: 'https://images.unsplash.com/photo-1501339847302-ac426a4a7cbb?w=600',
          alt: 'Atmosphere shot', root: { radius: 'rounded-(--ph-border-radius)' },
          mobile: { width: 'w-full', height: 'h-[250px]', objectFit: 'object-cover' },
          desktop: { height: 'h-[320px]', gridCols: 'col-span-2' },
          custom: { displayName: 'Photo 3' } },
        displayName: 'Image', parent: 'gallery_grid', nodes: [], linkedNodes: {}
      },
      gallery_card: {
        type: { resolvedName: 'Container' }, isCanvas: true,
        props: { canDelete: true, canEditName: true,
          root: { background: 'bg-(--ph-background)', radius: 'rounded-(--ph-border-radius)', shadow: 'shadow-lg' },
          mobile: { display: 'flex', flexDirection: 'flex-col', justifyContent: 'justify-center', p: 'p-8', gap: 'gap-3', width: 'w-full', height: 'h-full' },
          desktop: { gridCols: 'col-span-2' },
          custom: { displayName: 'Info Card' } },
        displayName: 'Container', parent: 'gallery_grid', nodes: ['gallery_card_title', 'gallery_card_body'], linkedNodes: {}
      },
      gallery_card_title: {
        type: { resolvedName: 'Text' }, isCanvas: false,
        props: { canDelete: true, canEditName: true,
          root: { color: 'text-(--ph-primary)', fontFamily: 'var(--ph-heading-font-family)' },
          mobile: { fontSize: 'text-xl', fontWeight: 'font-bold' },
          desktop: {}, text: 'Coworking', tagName: 'h3',
          custom: { displayName: 'Card Title' } },
        displayName: 'Text', parent: 'gallery_card', nodes: [], linkedNodes: {}
      },
      gallery_card_body: {
        type: { resolvedName: 'Text' }, isCanvas: false,
        props: { canDelete: true, canEditName: true,
          root: { color: 'text-(--ph-alternate-text)' },
          mobile: { fontSize: 'text-sm', lineHeight: 'leading-relaxed' },
          desktop: {}, text: 'Grab a table, plug in, and work while the espresso machine hums in the background.', tagName: 'p',
          custom: { displayName: 'Card Body' } },
        displayName: 'Text', parent: 'gallery_card', nodes: [], linkedNodes: {}
      },
    },
  },

  'rich-contact': {
    description: 'Full contact section — left side has heading + address + hours table, right side has a multi-field form (name, email, message + submit). Two equal columns on desktop, stacked on mobile. Alternate background.',
    usage: 'Change heading, address, hours, form fields. Adjust column widths.',
    nodes: {
      sec_contact: {
        type: { resolvedName: 'Container' }, isCanvas: true,
        props: { canDelete: true, canEditName: true, type: 'section',
          root: { background: 'bg-(--ph-alternate-background)' },
          mobile: { display: 'flex', flexDirection: 'flex-col', width: 'w-full', py: 'py-16', px: 'px-(--ph-container-padding-x)' },
          desktop: { py: 'py-24' },
          custom: { displayName: 'Contact Section' } },
        displayName: 'Container', parent: 'page_home', nodes: ['contact_inner'], linkedNodes: {}
      },
      contact_inner: {
        type: { resolvedName: 'Container' }, isCanvas: true,
        props: { canDelete: true, canEditName: true, root: {},
          mobile: { display: 'flex', flexDirection: 'flex-col', gap: 'gap-12', width: 'w-full', maxWidth: 'max-w-(--ph-content-width)', mx: 'mx-auto' },
          desktop: { flexDirection: 'flex-row', gap: 'gap-16' },
          custom: { displayName: 'Contact Inner' } },
        displayName: 'Container', parent: 'sec_contact', nodes: ['contact_info', 'contact_form_wrap'], linkedNodes: {}
      },
      contact_info: {
        type: { resolvedName: 'Container' }, isCanvas: true,
        props: { canDelete: true, canEditName: true, root: {},
          mobile: { display: 'flex', flexDirection: 'flex-col', gap: 'gap-6', width: 'w-full' },
          desktop: { width: 'w-1/2' },
          custom: { displayName: 'Contact Info' } },
        displayName: 'Container', parent: 'contact_inner', nodes: ['contact_title', 'contact_address', 'contact_hours_label', 'contact_hours_row1', 'contact_hours_row2', 'contact_hours_row3'], linkedNodes: {}
      },
      contact_title: {
        type: { resolvedName: 'Text' }, isCanvas: false,
        props: { canDelete: true, canEditName: true,
          root: { color: 'text-(--ph-primary)', fontFamily: 'var(--ph-heading-font-family)' },
          mobile: { fontSize: 'text-3xl', fontWeight: 'font-bold' },
          desktop: { fontSize: 'text-4xl' }, text: 'Find us in {{company.location}}', tagName: 'h2',
          custom: { displayName: 'Title' } },
        displayName: 'Text', parent: 'contact_info', nodes: [], linkedNodes: {}
      },
      contact_address: {
        type: { resolvedName: 'Text' }, isCanvas: false,
        props: { canDelete: true, canEditName: true,
          root: { color: 'text-(--ph-alternate-text)' },
          mobile: { fontSize: 'text-base', lineHeight: 'leading-relaxed' },
          desktop: {}, text: '{{company.address}}<br/>{{company.location}}<br/>{{company.phone}}', tagName: 'p',
          custom: { displayName: 'Address' } },
        displayName: 'Text', parent: 'contact_info', nodes: [], linkedNodes: {}
      },
      contact_hours_label: {
        type: { resolvedName: 'Text' }, isCanvas: false,
        props: { canDelete: true, canEditName: true,
          root: { color: 'text-(--ph-primary)', fontFamily: 'var(--ph-heading-font-family)' },
          mobile: { fontSize: 'text-lg', fontWeight: 'font-bold', mt: 'mt-4' },
          desktop: {}, text: 'Opening hours', tagName: 'h3',
          custom: { displayName: 'Hours Label' } },
        displayName: 'Text', parent: 'contact_info', nodes: [], linkedNodes: {}
      },
      contact_hours_row1: {
        type: { resolvedName: 'Container' }, isCanvas: true,
        props: { canDelete: true, canEditName: true, root: {},
          mobile: { display: 'flex', flexDirection: 'flex-row', justifyContent: 'justify-between', width: 'w-full', py: 'py-2' },
          desktop: {},
          custom: { displayName: 'Hours Row' } },
        displayName: 'Container', parent: 'contact_info',
        nodes: ['contact_day1', 'contact_time1'], linkedNodes: {}
      },
      contact_day1: {
        type: { resolvedName: 'Text' }, isCanvas: false,
        props: { canDelete: true, canEditName: true,
          root: { color: 'text-(--ph-text)' },
          mobile: { fontSize: 'text-sm', fontWeight: 'font-medium' },
          desktop: {}, text: 'Mon \u2014 Fri', tagName: 'p',
          custom: { displayName: 'Day' } },
        displayName: 'Text', parent: 'contact_hours_row1', nodes: [], linkedNodes: {}
      },
      contact_time1: {
        type: { resolvedName: 'Text' }, isCanvas: false,
        props: { canDelete: true, canEditName: true,
          root: { color: 'text-(--ph-alternate-text)' },
          mobile: { fontSize: 'text-sm' },
          desktop: {}, text: '08:00 \u2014 17:00', tagName: 'p',
          custom: { displayName: 'Time' } },
        displayName: 'Text', parent: 'contact_hours_row1', nodes: [], linkedNodes: {}
      },
      contact_hours_row2: {
        type: { resolvedName: 'Container' }, isCanvas: true,
        props: { canDelete: true, canEditName: true, root: {},
          mobile: { display: 'flex', flexDirection: 'flex-row', justifyContent: 'justify-between', width: 'w-full', py: 'py-2' },
          desktop: {},
          custom: { displayName: 'Hours Row' } },
        displayName: 'Container', parent: 'contact_info',
        nodes: ['contact_day2', 'contact_time2'], linkedNodes: {}
      },
      contact_day2: {
        type: { resolvedName: 'Text' }, isCanvas: false,
        props: { canDelete: true, canEditName: true,
          root: { color: 'text-(--ph-text)' },
          mobile: { fontSize: 'text-sm', fontWeight: 'font-medium' },
          desktop: {}, text: 'Saturday', tagName: 'p',
          custom: { displayName: 'Day' } },
        displayName: 'Text', parent: 'contact_hours_row2', nodes: [], linkedNodes: {}
      },
      contact_time2: {
        type: { resolvedName: 'Text' }, isCanvas: false,
        props: { canDelete: true, canEditName: true,
          root: { color: 'text-(--ph-alternate-text)' },
          mobile: { fontSize: 'text-sm' },
          desktop: {}, text: '10:00 \u2014 16:00', tagName: 'p',
          custom: { displayName: 'Time' } },
        displayName: 'Text', parent: 'contact_hours_row2', nodes: [], linkedNodes: {}
      },
      contact_hours_row3: {
        type: { resolvedName: 'Container' }, isCanvas: true,
        props: { canDelete: true, canEditName: true, root: {},
          mobile: { display: 'flex', flexDirection: 'flex-row', justifyContent: 'justify-between', width: 'w-full', py: 'py-2' },
          desktop: {},
          custom: { displayName: 'Hours Row' } },
        displayName: 'Container', parent: 'contact_info',
        nodes: ['contact_day3', 'contact_time3'], linkedNodes: {}
      },
      contact_day3: {
        type: { resolvedName: 'Text' }, isCanvas: false,
        props: { canDelete: true, canEditName: true,
          root: { color: 'text-(--ph-text)' },
          mobile: { fontSize: 'text-sm', fontWeight: 'font-medium' },
          desktop: {}, text: 'Sunday', tagName: 'p',
          custom: { displayName: 'Day' } },
        displayName: 'Text', parent: 'contact_hours_row3', nodes: [], linkedNodes: {}
      },
      contact_time3: {
        type: { resolvedName: 'Text' }, isCanvas: false,
        props: { canDelete: true, canEditName: true,
          root: { color: 'text-(--ph-alternate-text)' },
          mobile: { fontSize: 'text-sm' },
          desktop: {}, text: 'Closed', tagName: 'p',
          custom: { displayName: 'Time' } },
        displayName: 'Text', parent: 'contact_hours_row3', nodes: [], linkedNodes: {}
      },
      contact_form_wrap: {
        type: { resolvedName: 'Container' }, isCanvas: true,
        props: { canDelete: true, canEditName: true,
          root: { background: 'bg-(--ph-background)', radius: 'rounded-(--ph-border-radius)', shadow: 'shadow-md' },
          mobile: { display: 'flex', flexDirection: 'flex-col', width: 'w-full', p: 'p-8' },
          desktop: { width: 'w-1/2', p: 'p-10' },
          custom: { displayName: 'Form Card' } },
        displayName: 'Container', parent: 'contact_inner', nodes: ['contact_form_title', 'contact_form'], linkedNodes: {}
      },
      contact_form_title: {
        type: { resolvedName: 'Text' }, isCanvas: false,
        props: { canDelete: true, canEditName: true,
          root: { color: 'text-(--ph-primary)', fontFamily: 'var(--ph-heading-font-family)' },
          mobile: { fontSize: 'text-xl', fontWeight: 'font-bold', mb: 'mb-4' },
          desktop: {}, text: 'Send a message', tagName: 'h3',
          custom: { displayName: 'Form Title' } },
        displayName: 'Text', parent: 'contact_form_wrap', nodes: [], linkedNodes: {}
      },
      contact_form: {
        type: { resolvedName: 'Form' }, isCanvas: true,
        props: { canDelete: true, canEditName: true,
          formName: 'contact', root: {},
          mobile: { display: 'flex', flexDirection: 'flex-col', gap: 'gap-4', width: 'w-full' },
          desktop: {},
          custom: { displayName: 'Contact Form' } },
        displayName: 'Form', parent: 'contact_form_wrap', nodes: ['contact_field_name', 'contact_field_email', 'contact_field_msg', 'contact_submit'], linkedNodes: {}
      },
      contact_field_name: {
        type: { resolvedName: 'FormElement' }, isCanvas: false,
        props: { canDelete: true, canEditName: true, type: 'text', name: 'name', placeholder: 'Name', required: true,
          root: { border: 'border', borderWidth: 'border-(--ph-input-border-width)', borderStyle: 'border-solid', borderColor: 'border-(--ph-input-border-color)', radius: 'rounded-(--ph-input-border-radius)', background: 'bg-(--ph-input-bg-color)', color: 'text-(--ph-input-text-color)' },
          mobile: { p: 'p-(--ph-input-padding)', width: 'w-full' }, desktop: {},
          custom: { displayName: 'Name Field' } },
        displayName: 'FormElement', parent: 'contact_form', nodes: [], linkedNodes: {}
      },
      contact_field_email: {
        type: { resolvedName: 'FormElement' }, isCanvas: false,
        props: { canDelete: true, canEditName: true, type: 'email', name: 'email', placeholder: 'Email', required: true,
          root: { border: 'border', borderWidth: 'border-(--ph-input-border-width)', borderStyle: 'border-solid', borderColor: 'border-(--ph-input-border-color)', radius: 'rounded-(--ph-input-border-radius)', background: 'bg-(--ph-input-bg-color)', color: 'text-(--ph-input-text-color)' },
          mobile: { p: 'p-(--ph-input-padding)', width: 'w-full' }, desktop: {},
          custom: { displayName: 'Email Field' } },
        displayName: 'FormElement', parent: 'contact_form', nodes: [], linkedNodes: {}
      },
      contact_field_msg: {
        type: { resolvedName: 'FormElement' }, isCanvas: false,
        props: { canDelete: true, canEditName: true, type: 'textarea', name: 'message', placeholder: 'Your message', required: false,
          root: { border: 'border', borderWidth: 'border-(--ph-input-border-width)', borderStyle: 'border-solid', borderColor: 'border-(--ph-input-border-color)', radius: 'rounded-(--ph-input-border-radius)', background: 'bg-(--ph-input-bg-color)', color: 'text-(--ph-input-text-color)' },
          mobile: { p: 'p-(--ph-input-padding)', width: 'w-full' }, desktop: {},
          custom: { displayName: 'Message Field' } },
        displayName: 'FormElement', parent: 'contact_form', nodes: [], linkedNodes: {}
      },
      contact_submit: {
        type: { resolvedName: 'Button' }, isCanvas: false,
        props: { canDelete: true, canEditName: true, type: 'submit', text: 'Send',
          root: { background: 'bg-(--ph-primary)', color: 'text-(--ph-primary-text)', radius: 'rounded-(--ph-border-radius)' },
          mobile: { width: 'w-full', py: 'py-3', fontWeight: 'font-bold', textAlign: 'text-center' },
          desktop: {},
          custom: { displayName: 'Submit Button' } },
        displayName: 'Button', parent: 'contact_form', nodes: [], linkedNodes: {}
      },
    },
  },

  'quote-testimonials': {
    description: 'Testimonial cards in a 2-column grid. Each card has: star rating row, quote text, reviewer name + role. Cards have background, border, shadow, rounded corners. Section has eyebrow + heading.',
    usage: 'Change quote text, names, star count. Add/remove cards by adding nodes to grid.',
    nodes: {
      sec_testimonials: {
        type: { resolvedName: 'Container' }, isCanvas: true,
        props: { canDelete: true, canEditName: true, type: 'section',
          root: { background: 'bg-(--ph-background)' },
          mobile: { display: 'flex', flexDirection: 'flex-col', alignItems: 'items-center', width: 'w-full', py: 'py-16', px: 'px-(--ph-container-padding-x)', gap: 'gap-10' },
          desktop: { py: 'py-24' },
          custom: { displayName: 'Testimonials Section' } },
        displayName: 'Container', parent: 'page_home', nodes: ['test_header', 'test_grid'], linkedNodes: {}
      },
      test_header: {
        type: { resolvedName: 'Container' }, isCanvas: true,
        props: { canDelete: true, canEditName: true, root: {},
          mobile: { display: 'flex', flexDirection: 'flex-col', alignItems: 'items-center', gap: 'gap-2', width: 'w-full' },
          desktop: {},
          custom: { displayName: 'Header' } },
        displayName: 'Container', parent: 'sec_testimonials', nodes: ['test_eyebrow', 'test_title'], linkedNodes: {}
      },
      test_eyebrow: {
        type: { resolvedName: 'Text' }, isCanvas: false,
        props: { canDelete: true, canEditName: true,
          root: { color: 'text-(--ph-accent)' },
          mobile: { fontSize: 'text-xs', fontWeight: 'font-bold', letterSpacing: 'tracking-widest', textAlign: 'text-center' },
          desktop: {}, text: 'HAPPY GUESTS', tagName: 'p',
          custom: { displayName: 'Eyebrow' } },
        displayName: 'Text', parent: 'test_header', nodes: [], linkedNodes: {}
      },
      test_title: {
        type: { resolvedName: 'Text' }, isCanvas: false,
        props: { canDelete: true, canEditName: true,
          root: { color: 'text-(--ph-primary)', fontFamily: 'var(--ph-heading-font-family)' },
          mobile: { fontSize: 'text-3xl', fontWeight: 'font-bold', textAlign: 'text-center' },
          desktop: { fontSize: 'text-4xl' }, text: 'What customers say', tagName: 'h2',
          custom: { displayName: 'Title' } },
        displayName: 'Text', parent: 'test_header', nodes: [], linkedNodes: {}
      },
      test_grid: {
        type: { resolvedName: 'Container' }, isCanvas: true,
        props: { canDelete: true, canEditName: true, root: {},
          mobile: { display: 'grid', gridCols: 'grid-cols-1', gap: 'gap-6', width: 'w-full', maxWidth: 'max-w-4xl', mx: 'mx-auto' },
          desktop: { gridCols: 'grid-cols-2' },
          custom: { displayName: 'Grid' } },
        displayName: 'Container', parent: 'sec_testimonials', nodes: ['test_card1', 'test_card2'], linkedNodes: {}
      },
      test_card1: {
        type: { resolvedName: 'Container' }, isCanvas: true,
        props: { canDelete: true, canEditName: true,
          root: { background: 'bg-(--ph-background)', radius: 'rounded-(--ph-border-radius)', border: 'border', borderColor: 'border-(--ph-alternate-background)', shadow: 'shadow-sm' },
          mobile: { display: 'flex', flexDirection: 'flex-col', gap: 'gap-4', p: 'p-6', width: 'w-full' },
          desktop: { p: 'p-8' },
          custom: { displayName: 'Quote Card' } },
        displayName: 'Container', parent: 'test_grid', nodes: ['test_stars1', 'test_quote1', 'test_author1'], linkedNodes: {}
      },
      test_stars1: {
        type: { resolvedName: 'Text' }, isCanvas: false,
        props: { canDelete: true, canEditName: true, root: {},
          mobile: { fontSize: 'text-sm' }, desktop: {},
          text: '\u2605\u2605\u2605\u2605\u2605', tagName: 'p',
          custom: { displayName: 'Stars' } },
        displayName: 'Text', parent: 'test_card1', nodes: [], linkedNodes: {}
      },
      test_quote1: {
        type: { resolvedName: 'Text' }, isCanvas: false,
        props: { canDelete: true, canEditName: true,
          root: { color: 'text-(--ph-text)' },
          mobile: { fontSize: 'text-sm', lineHeight: 'leading-relaxed' },
          desktop: {}, text: '\u201cExactly the kind of spot this neighborhood needed. The coffee is excellent, the vibe is calm, and they actually care about the music.\u201d', tagName: 'p',
          custom: { displayName: 'Quote' } },
        displayName: 'Text', parent: 'test_card1', nodes: [], linkedNodes: {}
      },
      test_author1: {
        type: { resolvedName: 'Text' }, isCanvas: false,
        props: { canDelete: true, canEditName: true,
          root: { color: 'text-(--ph-alternate-text)' },
          mobile: { fontSize: 'text-xs', fontWeight: 'font-medium' },
          desktop: {}, text: 'Mara K. \u2014 Regular', tagName: 'p',
          custom: { displayName: 'Author' } },
        displayName: 'Text', parent: 'test_card1', nodes: [], linkedNodes: {}
      },
      test_card2: {
        type: { resolvedName: 'Container' }, isCanvas: true,
        props: { canDelete: true, canEditName: true,
          root: { background: 'bg-(--ph-background)', radius: 'rounded-(--ph-border-radius)', border: 'border', borderColor: 'border-(--ph-alternate-background)', shadow: 'shadow-sm' },
          mobile: { display: 'flex', flexDirection: 'flex-col', gap: 'gap-4', p: 'p-6', width: 'w-full' },
          desktop: { p: 'p-8' },
          custom: { displayName: 'Quote Card' } },
        displayName: 'Container', parent: 'test_grid', nodes: ['test_stars2', 'test_quote2', 'test_author2'], linkedNodes: {}
      },
      test_stars2: {
        type: { resolvedName: 'Text' }, isCanvas: false,
        props: { canDelete: true, canEditName: true, root: {},
          mobile: { fontSize: 'text-sm' }, desktop: {},
          text: '\u2605\u2605\u2605\u2605\u2605', tagName: 'p',
          custom: { displayName: 'Stars' } },
        displayName: 'Text', parent: 'test_card2', nodes: [], linkedNodes: {}
      },
      test_quote2: {
        type: { resolvedName: 'Text' }, isCanvas: false,
        props: { canDelete: true, canEditName: true,
          root: { color: 'text-(--ph-text)' },
          mobile: { fontSize: 'text-sm', lineHeight: 'leading-relaxed' },
          desktop: {}, text: '\u201cI bring work, order a cortado, and somehow finish a whole LP without checking my phone. The quiet hour here is real.\u201d', tagName: 'p',
          custom: { displayName: 'Quote' } },
        displayName: 'Text', parent: 'test_card2', nodes: [], linkedNodes: {}
      },
      test_author2: {
        type: { resolvedName: 'Text' }, isCanvas: false,
        props: { canDelete: true, canEditName: true,
          root: { color: 'text-(--ph-alternate-text)' },
          mobile: { fontSize: 'text-xs', fontWeight: 'font-medium' },
          desktop: {}, text: 'Ellis P. \u2014 Weekday regular', tagName: 'p',
          custom: { displayName: 'Author' } },
        displayName: 'Text', parent: 'test_card2', nodes: [], linkedNodes: {}
      },
    },
  },

  'offering-list': {
    description: 'Menu / offering list with items in rows. Each item has a title (left-aligned, bold) and description underneath. Optional dotted line separator between items. Good for "What we serve", services, or menu sections.',
    usage: 'Change item titles and descriptions. Add/remove items. Style with borders.',
    nodes: {
      sec_offerings: {
        type: { resolvedName: 'Container' }, isCanvas: true,
        props: { canDelete: true, canEditName: true, type: 'section',
          root: { background: 'bg-(--ph-background)' },
          mobile: { display: 'flex', flexDirection: 'flex-col', width: 'w-full', py: 'py-16', px: 'px-(--ph-container-padding-x)' },
          desktop: { py: 'py-24' },
          custom: { displayName: 'Offerings Section' } },
        displayName: 'Container', parent: 'page_home', nodes: ['offer_inner'], linkedNodes: {}
      },
      offer_inner: {
        type: { resolvedName: 'Container' }, isCanvas: true,
        props: { canDelete: true, canEditName: true, root: {},
          mobile: { display: 'flex', flexDirection: 'flex-col', gap: 'gap-8', width: 'w-full', maxWidth: 'max-w-3xl', mx: 'mx-auto' },
          desktop: {},
          custom: { displayName: 'Inner' } },
        displayName: 'Container', parent: 'sec_offerings', nodes: ['offer_title', 'offer_list'], linkedNodes: {}
      },
      offer_title: {
        type: { resolvedName: 'Text' }, isCanvas: false,
        props: { canDelete: true, canEditName: true,
          root: { color: 'text-(--ph-primary)', fontFamily: 'var(--ph-heading-font-family)' },
          mobile: { fontSize: 'text-3xl', fontWeight: 'font-bold' },
          desktop: { fontSize: 'text-4xl' }, text: 'What we serve', tagName: 'h2',
          custom: { displayName: 'Title' } },
        displayName: 'Text', parent: 'offer_inner', nodes: [], linkedNodes: {}
      },
      offer_list: {
        type: { resolvedName: 'Container' }, isCanvas: true,
        props: { canDelete: true, canEditName: true, root: {},
          mobile: { display: 'flex', flexDirection: 'flex-col', width: 'w-full' },
          desktop: {},
          custom: { displayName: 'Items List' } },
        displayName: 'Container', parent: 'offer_inner', nodes: ['offer_item1', 'offer_item2', 'offer_item3'], linkedNodes: {}
      },
      offer_item1: {
        type: { resolvedName: 'Container' }, isCanvas: true,
        props: { canDelete: true, canEditName: true,
          root: { border: 'border-b', borderColor: 'border-(--ph-alternate-background)' },
          mobile: { display: 'flex', flexDirection: 'flex-col', gap: 'gap-1', py: 'py-5', width: 'w-full' },
          desktop: {},
          custom: { displayName: 'Menu Item' } },
        displayName: 'Container', parent: 'offer_list', nodes: ['offer_name1', 'offer_desc1'], linkedNodes: {}
      },
      offer_name1: {
        type: { resolvedName: 'Text' }, isCanvas: false,
        props: { canDelete: true, canEditName: true,
          root: { color: 'text-(--ph-text)' },
          mobile: { fontSize: 'text-base', fontWeight: 'font-semibold' },
          desktop: {}, text: 'The Grizzly', tagName: 'h3',
          custom: { displayName: 'Item Name' } },
        displayName: 'Text', parent: 'offer_item1', nodes: [], linkedNodes: {}
      },
      offer_desc1: {
        type: { resolvedName: 'Text' }, isCanvas: false,
        props: { canDelete: true, canEditName: true,
          root: { color: 'text-(--ph-alternate-text)' },
          mobile: { fontSize: 'text-sm' },
          desktop: {}, text: 'Double-shot espresso with oat milk and cinnamon. Our house signature since day one.', tagName: 'p',
          custom: { displayName: 'Item Description' } },
        displayName: 'Text', parent: 'offer_item1', nodes: [], linkedNodes: {}
      },
      offer_item2: {
        type: { resolvedName: 'Container' }, isCanvas: true,
        props: { canDelete: true, canEditName: true,
          root: { border: 'border-b', borderColor: 'border-(--ph-alternate-background)' },
          mobile: { display: 'flex', flexDirection: 'flex-col', gap: 'gap-1', py: 'py-5', width: 'w-full' },
          desktop: {},
          custom: { displayName: 'Menu Item' } },
        displayName: 'Container', parent: 'offer_list', nodes: ['offer_name2', 'offer_desc2'], linkedNodes: {}
      },
      offer_name2: {
        type: { resolvedName: 'Text' }, isCanvas: false,
        props: { canDelete: true, canEditName: true,
          root: { color: 'text-(--ph-text)' },
          mobile: { fontSize: 'text-base', fontWeight: 'font-semibold' },
          desktop: {}, text: 'V60 Filter Coffee', tagName: 'h3',
          custom: { displayName: 'Item Name' } },
        displayName: 'Text', parent: 'offer_item2', nodes: [], linkedNodes: {}
      },
      offer_desc2: {
        type: { resolvedName: 'Text' }, isCanvas: false,
        props: { canDelete: true, canEditName: true,
          root: { color: 'text-(--ph-alternate-text)' },
          mobile: { fontSize: 'text-sm' },
          desktop: {}, text: 'Hand-poured from a rotating roster of single-origin beans. Ask the barista what is on today.', tagName: 'p',
          custom: { displayName: 'Item Description' } },
        displayName: 'Text', parent: 'offer_item2', nodes: [], linkedNodes: {}
      },
      offer_item3: {
        type: { resolvedName: 'Container' }, isCanvas: true,
        props: { canDelete: true, canEditName: true,
          root: { border: 'border-b', borderColor: 'border-(--ph-alternate-background)' },
          mobile: { display: 'flex', flexDirection: 'flex-col', gap: 'gap-1', py: 'py-5', width: 'w-full' },
          desktop: {},
          custom: { displayName: 'Menu Item' } },
        displayName: 'Container', parent: 'offer_list', nodes: ['offer_name3', 'offer_desc3'], linkedNodes: {}
      },
      offer_name3: {
        type: { resolvedName: 'Text' }, isCanvas: false,
        props: { canDelete: true, canEditName: true,
          root: { color: 'text-(--ph-text)' },
          mobile: { fontSize: 'text-base', fontWeight: 'font-semibold' },
          desktop: {}, text: 'Matcha & Chai Latte', tagName: 'h3',
          custom: { displayName: 'Item Name' } },
        displayName: 'Text', parent: 'offer_item3', nodes: [], linkedNodes: {}
      },
      offer_desc3: {
        type: { resolvedName: 'Text' }, isCanvas: false,
        props: { canDelete: true, canEditName: true,
          root: { color: 'text-(--ph-alternate-text)' },
          mobile: { fontSize: 'text-sm' },
          desktop: {}, text: 'Ceremonial-grade matcha or house-blended chai with your choice of milk.', tagName: 'p',
          custom: { displayName: 'Item Description' } },
        displayName: 'Text', parent: 'offer_item3', nodes: [], linkedNodes: {}
      },
    },
  },

  'structured-footer': {
    description: 'Proper multi-row footer with dark background. Row 1: brand name + tagline. Row 2: address + phone as separate text nodes. Row 3: ButtonList with nav links (Privacy, Terms, etc). Row 4: copyright line. Each piece of content is its own node with independent styling — never crammed into one Text node.',
    usage: 'Change brand, address, links, copyright. Add social icon buttons. Adjust layout to multi-column on desktop if needed.',
    nodes: {
      sec_footer: {
        type: { resolvedName: 'Container' }, isCanvas: true,
        props: { canDelete: true, canEditName: true,
          root: { background: 'bg-(--ph-primary)' },
          mobile: { display: 'flex', flexDirection: 'flex-col', alignItems: 'items-center', width: 'w-full', py: 'py-12', px: 'px-6', gap: 'gap-6' },
          desktop: { py: 'py-16' },
          custom: { displayName: 'Footer Section' } },
        displayName: 'Container', parent: 'ftr_content', nodes: ['ftr_brand', 'ftr_address', 'ftr_links', 'ftr_copy'], linkedNodes: {}
      },
      ftr_brand: {
        type: { resolvedName: 'Text' }, isCanvas: false,
        props: { canDelete: true, canEditName: true,
          root: { color: 'text-(--ph-primary-text)', fontFamily: 'var(--ph-heading-font-family)' },
          mobile: { fontSize: 'text-lg', fontWeight: 'font-bold', textAlign: 'text-center' },
          desktop: {}, text: '{{company.name}}', tagName: 'h3',
          custom: { displayName: 'Brand' } },
        displayName: 'Text', parent: 'sec_footer', nodes: [], linkedNodes: {}
      },
      ftr_address: {
        type: { resolvedName: 'Text' }, isCanvas: false,
        props: { canDelete: true, canEditName: true,
          root: { color: 'text-(--ph-primary-text)' },
          mobile: { fontSize: 'text-sm', textAlign: 'text-center' },
          desktop: {}, text: '{{company.address}} \u00b7 {{company.location}} \u00b7 {{company.phone}}', tagName: 'p',
          custom: { displayName: 'Address Line' } },
        displayName: 'Text', parent: 'sec_footer', nodes: [], linkedNodes: {}
      },
      ftr_links: {
        type: { resolvedName: 'ButtonList' }, isCanvas: true,
        props: { canDelete: true, canEditName: true, root: {},
          mobile: { display: 'flex', flexDirection: 'flex-row', gap: 'gap-4', justifyContent: 'justify-center', flexWrap: 'flex-wrap' },
          desktop: {},
          custom: { displayName: 'Footer Links' } },
        displayName: 'ButtonList', parent: 'sec_footer', nodes: ['ftr_link1', 'ftr_link2', 'ftr_link3'], linkedNodes: {}
      },
      ftr_link1: {
        type: { resolvedName: 'Button' }, isCanvas: false,
        props: { canDelete: true, canEditName: true,
          root: { background: 'bg-transparent', color: 'text-(--ph-primary-text)' },
          mobile: { fontSize: 'text-sm', px: 'px-0', py: 'py-0' },
          desktop: {}, text: 'Privacy Policy', url: '/privacy',
          custom: { displayName: 'Link' } },
        displayName: 'Button', parent: 'ftr_links', nodes: [], linkedNodes: {}
      },
      ftr_link2: {
        type: { resolvedName: 'Button' }, isCanvas: false,
        props: { canDelete: true, canEditName: true,
          root: { background: 'bg-transparent', color: 'text-(--ph-primary-text)' },
          mobile: { fontSize: 'text-sm', px: 'px-0', py: 'py-0' },
          desktop: {}, text: 'Terms of Service', url: '/terms',
          custom: { displayName: 'Link' } },
        displayName: 'Button', parent: 'ftr_links', nodes: [], linkedNodes: {}
      },
      ftr_link3: {
        type: { resolvedName: 'Button' }, isCanvas: false,
        props: { canDelete: true, canEditName: true,
          root: { background: 'bg-transparent', color: 'text-(--ph-primary-text)' },
          mobile: { fontSize: 'text-sm', px: 'px-0', py: 'py-0' },
          desktop: {}, text: 'Contact', url: 'mailto:{{company.email}}',
          custom: { displayName: 'Link' } },
        displayName: 'Button', parent: 'ftr_links', nodes: [], linkedNodes: {}
      },
      ftr_copy: {
        type: { resolvedName: 'Text' }, isCanvas: false,
        props: { canDelete: true, canEditName: true,
          root: { color: 'text-(--ph-primary-text)' },
          mobile: { fontSize: 'text-xs', textAlign: 'text-center' },
          desktop: {}, text: '\u00a9 {{year}} {{company.name}}. All rights reserved.', tagName: 'p',
          custom: { displayName: 'Copyright' } },
        displayName: 'Text', parent: 'sec_footer', nodes: [], linkedNodes: {}
      },
    },
  },
};
