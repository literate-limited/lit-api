import db from '../db.js';
import { upsertStatute, upsertCase } from '../services/law-ingest.service.js';

/**
 * Seed lawlore test data
 * Run with: node scripts/seed-lawlore.js
 */

async function seedTestData() {
  try {
    console.log('Seeding lawlore test data...');

    // Get the law brand ID
    const brand = await db.one(
      'SELECT id FROM brands WHERE code = $1',
      ['law']
    );

    if (!brand) {
      throw new Error('Law brand not found. Run migrations first.');
    }

    const brandId = brand.id;
    console.log('Found law brand:', brandId);

    // Get source IDs
    const cthSource = await db.one(
      'SELECT id FROM law_sources WHERE brand_id = $1 AND code = $2',
      [brandId, 'cth_acts']
    );

    const hcaSource = await db.one(
      'SELECT id FROM law_sources WHERE brand_id = $1 AND code = $2',
      [brandId, 'hca_cases']
    );

    if (!cthSource || !hcaSource) {
      throw new Error('Law sources not found. Run migrations first.');
    }

    // Seed Commonwealth Statutes
    const statutes = [
      {
        title: 'Crimes Act 1995',
        shortTitle: 'Crimes Act',
        content: 'This Act establishes offences and defences under the criminal law. PART 1: Introduction. This Part sets out the objects of the Act and explains its basic structure. Part 2 deals with general principles of criminal responsibility. PART 2: General Principles. Section 10 establishes the general principles of criminal responsibility. An offence has physical and fault elements. The fault element may be intention, knowledge, recklessness or negligence. Section 11 deals with attempt. A person who attempts to commit an offence commits an offence.',
        jurisdiction: 'cth',
        status: 'current',
        year: 1995,
        effectiveDate: new Date('1995-01-01'),
        url: 'https://legislation.gov.au/c1995a00043',
        sections: ['1', '2', '3', '10', '11', '15']
      },
      {
        title: 'Corporations Act 2001',
        shortTitle: 'Corporations Act',
        content: 'An Act to establish a national legal system for the regulation of corporations, financial markets, and financial services, and for related purposes. CHAPTER 1: PRELIMINARY. This Chapter sets out the objects of the Act, defines key terms, and explains how the Act applies. The Act applies to corporations and financial services providers. Section 12CF defines financial services. The definition includes the provision of financial product advice and the dealing in financial products.',
        jurisdiction: 'cth',
        status: 'current',
        year: 2001,
        effectiveDate: new Date('2001-07-01'),
        url: 'https://legislation.gov.au/c2001a00050',
        sections: ['1', '12CF', '760A', '910A']
      },
      {
        title: 'Constitutional Law and Practice Act 1999',
        shortTitle: 'Constitutional Law and Practice Act',
        content: 'This Act deals with the interpretation and application of the Australian Constitution. The Constitution is the supreme law of the Commonwealth. Section 51 grants Parliament power to make laws. These powers are limited by the structure of the Constitution and principles of constitutional law.',
        jurisdiction: 'cth',
        status: 'current',
        year: 1999,
        effectiveDate: new Date('1999-06-15'),
        url: 'https://legislation.gov.au/sample',
        sections: ['51', '52']
      }
    ];

    let createdStatutes = 0;
    for (const statute of statutes) {
      try {
        await upsertStatute(brandId, cthSource.id, statute);
        createdStatutes++;
        console.log(`✓ Created statute: ${statute.title}`);
      } catch (err) {
        console.error(`✗ Error creating statute ${statute.title}:`, err.message);
      }
    }

    // Seed High Court Cases
    const cases = [
      {
        title: 'Australian Capital Television Pty Ltd v Commonwealth',
        citation: '[1992] HCA 45',
        content: 'This case deals with freedom of communication in the Australian Constitution. The High Court held that the Constitution protects a freedom of political communication. Section 7 and 24 of the Constitution provide for the election of members of Parliament by the people. Such elections would be impossible without freedom to discuss government and political matters. The Court held that the Constitution protects an implied freedom of political communication.',
        court: 'High Court of Australia',
        judges: ['Mason CJ', 'Brennan J', 'Dawson J', 'Toohey J', 'Gaudron J', 'McHugh J'],
        year: 1992,
        jurisdiction: 'hca',
        headnotes: 'Constitutional law - Freedom of communication - Election of members of Parliament - Whether Constitution implies freedom of political communication',
        holding: 'The Constitution implies a freedom of political communication necessary to make representative government effective.',
        url: 'https://austlii.edu.au/cgi-bin/viewdoc/au/cases/cth/HCA/1992/45.html'
      },
      {
        title: 'Mabo v State of Queensland (No 2)',
        citation: '[1992] HCA 23',
        content: 'This case concerns native title to land in Australia. The plaintiff claimed to be members of the Meriam people and asserted that they were entitled to the land on the island of Mer. The High Court held that the common law of Australia recognizes a form of native title. Native title is the pre-existing rights and interests of Aboriginal people to land. These rights existed before colonization and may persist.',
        court: 'High Court of Australia',
        judges: ['Mason CJ', 'Brennan J', 'Dawson J', 'Toohey J', 'Gaudron J', 'McHugh J'],
        year: 1992,
        jurisdiction: 'hca',
        headnotes: 'Native title - Aboriginal customary law - Land rights - Whether common law recognizes native title',
        holding: 'Native title is recognised at common law and represents the rights and interests of Aboriginal people to their traditional lands.',
        url: 'https://austlii.edu.au/cgi-bin/viewdoc/au/cases/cth/HCA/1992/23.html'
      },
      {
        title: 'Rookes v Barnard',
        citation: '[2020] HCA 22',
        content: 'This case concerns tortious liability and damages. The plaintiff suffered loss as a result of the defendant\'s conduct. The High Court considered the principles governing liability in tort and the assessment of damages. The Court held that damages must be assessed to put the plaintiff in the same position as if the tort had not been committed.',
        court: 'High Court of Australia',
        judges: ['French CJ', 'Bell J', 'Gageler J', 'Keane J'],
        year: 2020,
        jurisdiction: 'hca',
        headnotes: 'Tort - Damages - Assessment of damages - Principles applicable',
        holding: 'Damages in tort are to be assessed by reference to the actual loss suffered by the plaintiff.',
        url: 'https://austlii.edu.au/sample'
      }
    ];

    let createdCases = 0;
    for (const caseData of cases) {
      try {
        await upsertCase(brandId, hcaSource.id, caseData);
        createdCases++;
        console.log(`✓ Created case: ${caseData.citation}`);
      } catch (err) {
        console.error(`✗ Error creating case ${caseData.citation}:`, err.message);
      }
    }

    console.log(`\n✓ Seeding complete: ${createdStatutes} statutes, ${createdCases} cases`);
  } catch (error) {
    console.error('Error seeding test data:', error);
    process.exit(1);
  }
}

seedTestData();
