import { Document, Page, Text, View, StyleSheet, Image } from '@react-pdf/renderer';

const styles = StyleSheet.create({
  page: {
    padding: 40,
    fontSize: 10,
    fontFamily: 'Helvetica',
    lineHeight: 1.4,
  },
  headerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 20,
    borderBottom: '2 solid #111827',
    paddingBottom: 10,
  },
  logo: {
    width: 80,
    height: 40,
    objectFit: 'contain',
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#111827',
    textAlign: 'center',
    flex: 1,
  },
  subHeader: {
    fontSize: 12,
    marginBottom: 10,
    padding: 8,
    backgroundColor: '#f3f4f6',
    fontWeight: 'bold',
    textAlign: 'center',
    color: '#111827',
  },
  section: {
    marginBottom: 24,
  },
  row: {
    flexDirection: 'row',
    marginBottom: 6,
    paddingVertical: 2,
  },
  label: {
    width: '48%',
    fontWeight: 'bold',
    color: '#374151',
  },
  value: {
    width: '52%',
    color: '#111827',
  },
  table: {
    display: 'table',
    width: '100%',
    marginTop: 8,
    borderStyle: 'solid',
    borderWidth: 1,
    borderColor: '#d1d5db',
  },
  tableRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#d1d5db',
  },
  tableHeader: {
    backgroundColor: '#f3f4f6',
    fontWeight: 'bold',
  },
  tableCell: {
    padding: 8,
    flex: 1,
    borderRightWidth: 1,
    borderRightColor: '#d1d5db',
  },
  attestation: {
    marginTop: 30,
    fontSize: 9.5,
    lineHeight: 1.5,
    textAlign: 'justify',
  },
  signatureLine: {
    marginTop: 40,
    borderBottomWidth: 1,
    borderBottomColor: '#111827',
    width: '60%',
  },
  signatureLabel: {
    fontSize: 9,
    marginTop: 4,
    color: '#6b7280',
  },
  footer: {
    marginTop: 40,
    fontSize: 9,
    textAlign: 'center',
    color: '#6b7280',
  },
});

export function LoanApplicationPDF({ form, borrowers, rentRoll, owners, organization }: any) {
  const orgName = organization?.name || 'CTF Funding';
  const logoUrl = organization?.logoUrl || null;

  return (
    <Document>
      {/* PAGE 1 - Property & Financial Summary */}
      <Page size="A4" style={styles.page}>
        {/* White-labeled Header */}
        <View style={styles.headerContainer}>
          {logoUrl && <Image src={logoUrl} style={styles.logo} />}
          <Text style={styles.headerTitle}>{orgName} Loan Application</Text>
        </View>

        <Text style={{ fontSize: 10, textAlign: 'center', marginBottom: 20, color: '#6b7280' }}>
          Generated on {new Date().toLocaleDateString('en-US')}
        </Text>

        <View style={styles.section}>
          <Text style={styles.subHeader}>PROPERTY INFORMATION</Text>
          <View style={styles.row}><Text style={styles.label}>Property Street Address:</Text><Text style={styles.value}>{form.propertyAddress || 'N/A'}</Text></View>
          <View style={styles.row}><Text style={styles.label}>City:</Text><Text style={styles.value}>{form.city || 'N/A'}</Text></View>
          <View style={styles.row}><Text style={styles.label}>County:</Text><Text style={styles.value}>{form.county || 'N/A'}</Text></View>
          <View style={styles.row}><Text style={styles.label}>State / Zip:</Text><Text style={styles.value}>{form.state} {form.zip}</Text></View>
          <View style={styles.row}><Text style={styles.label}>Estimated Value:</Text><Text style={styles.value}>${form.estimatedValue || '0'}</Text></View>
          <View style={styles.row}><Text style={styles.label}>Number of Units:</Text><Text style={styles.value}>{form.units || '1'}</Text></View>
          <View style={styles.row}><Text style={styles.label}>Year Built:</Text><Text style={styles.value}>{form.yearBuilt || 'N/A'}</Text></View>
          <View style={styles.row}><Text style={styles.label}>Square Footage:</Text><Text style={styles.value}>{form.sqFt || 'N/A'}</Text></View>
        </View>

        <View style={styles.section}>
          <Text style={styles.subHeader}>FINANCIAL SUMMARY</Text>
          <View style={styles.row}><Text style={styles.label}>Annual Rental Income:</Text><Text style={styles.value}>${form.rentalIncome || '0'}</Text></View>
          <View style={styles.row}><Text style={styles.label}>Property Taxes (Annual):</Text><Text style={styles.value}>${form.taxes || '0'}</Text></View>
          <View style={styles.row}><Text style={styles.label}>Insurance (Annual):</Text><Text style={styles.value}>${form.insurance || '0'}</Text></View>
          <View style={styles.row}><Text style={styles.label}>HOA Fees (Annual):</Text><Text style={styles.value}>${form.hoa || '0'}</Text></View>
        </View>

        <View style={styles.section}>
          <Text style={styles.subHeader}>RENT ROLL</Text>
          <View style={styles.table}>
            <View style={[styles.tableRow, styles.tableHeader]}>
              <Text style={styles.tableCell}>Unit</Text>
              <Text style={styles.tableCell}>Type</Text>
              <Text style={styles.tableCell}>Monthly Rent</Text>
            </View>
            {rentRoll?.map((r: any, i: number) => (
              <View key={i} style={styles.tableRow}>
                <Text style={styles.tableCell}>{r.unit || '-'}</Text>
                <Text style={styles.tableCell}>{r.type || '-'}</Text>
                <Text style={styles.tableCell}>${r.monthlyRent || '0'}</Text>
              </View>
            ))}
          </View>
        </View>
      </Page>

      {/* PAGE 2 - Loan Request & Purpose */}
      <Page size="A4" style={styles.page}>
        <View style={styles.headerContainer}>
          {logoUrl && <Image src={logoUrl} style={styles.logo} />}
          <Text style={styles.headerTitle}>{orgName} Loan Application</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.subHeader}>LOAN REQUEST</Text>
          <View style={styles.row}><Text style={styles.label}>LTV Requested:</Text><Text style={styles.value}>{form.ltv || 'N/A'}%</Text></View>
          <View style={styles.row}><Text style={styles.label}>Loan Amount:</Text><Text style={styles.value}>${form.loanAmount || '0'}</Text></View>
        </View>

        <View style={styles.section}>
          <Text style={styles.subHeader}>LOAN PURPOSE</Text>
          <Text style={{ marginBottom: 8 }}>
            {form.acquisition ? 'Acquisition' : form.refinance ? 'Refinance' : form.cashOutRefi ? 'Cash-Out Refinance' : 'N/A'}
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.subHeader}>ENTITY INFORMATION</Text>
          <View style={styles.row}><Text style={styles.label}>Entity Name:</Text><Text style={styles.value}>{form.entityName || 'N/A'}</Text></View>
          <View style={styles.row}><Text style={styles.label}>Entity Type:</Text><Text style={styles.value}>{form.entityType || 'N/A'}</Text></View>
          <View style={styles.row}><Text style={styles.label}>Tax ID:</Text><Text style={styles.value}>{form.entityTaxId || 'N/A'}</Text></View>
          <View style={styles.row}><Text style={styles.label}>State Filed:</Text><Text style={styles.value}>{form.entityStateFiled || 'N/A'}</Text></View>
        </View>
      </Page>

      {/* Borrower Pages */}
      {borrowers?.map((borrower: any, index: number) => (
        <Page key={index} size="A4" style={styles.page}>
          <View style={styles.headerContainer}>
            {logoUrl && <Image src={logoUrl} style={styles.logo} />}
            <Text style={styles.headerTitle}>{orgName} Loan Application</Text>
          </View>

          <Text style={styles.header}>Borrower {index + 1}</Text>

          <View style={styles.section}>
            <Text style={styles.subHeader}>BORROWER INFORMATION</Text>
            <View style={styles.row}><Text style={styles.label}>Full Name:</Text><Text style={styles.value}>{borrower.fullName || 'N/A'}</Text></View>
            <View style={styles.row}><Text style={styles.label}>Date of Birth:</Text><Text style={styles.value}>{borrower.dateOfBirth || 'N/A'}</Text></View>
            <View style={styles.row}><Text style={styles.label}>Social Security:</Text><Text style={styles.value}>{borrower.socialSecurity || 'N/A'}</Text></View>
            <View style={styles.row}><Text style={styles.label}>Full Home Address:</Text><Text style={styles.value}>{borrower.fullHomeAddress || 'N/A'}</Text></View>
          </View>

          <View style={styles.section}>
            <Text style={styles.subHeader}>DEMOGRAPHICS</Text>
            <View style={styles.row}><Text style={styles.label}>Ethnicity:</Text><Text style={styles.value}>{borrower.ethnicity || 'Not provided'}</Text></View>
            <View style={styles.row}><Text style={styles.label}>Race:</Text><Text style={styles.value}>{borrower.race || 'Not provided'}</Text></View>
            <View style={styles.row}><Text style={styles.label}>Sex:</Text><Text style={styles.value}>{borrower.sex || 'Not provided'}</Text></View>
          </View>

          <View style={styles.section}>
            <Text style={styles.subHeader}>DECLARATIONS</Text>
            <View style={styles.row}><Text style={styles.label}>Outstanding judgments:</Text><Text style={styles.value}>{borrower.judgments ? 'Yes' : 'No'}</Text></View>
            <View style={styles.row}><Text style={styles.label}>Bankruptcy (last 7 years):</Text><Text style={styles.value}>{borrower.bankruptcy ? 'Yes' : 'No'}</Text></View>
            <View style={styles.row}><Text style={styles.label}>Foreclosure (last 7 years):</Text><Text style={styles.value}>{borrower.foreclosure ? 'Yes' : 'No'}</Text></View>
            <View style={styles.row}><Text style={styles.label}>Party to a lawsuit:</Text><Text style={styles.value}>{borrower.lawsuit ? 'Yes' : 'No'}</Text></View>
            <View style={styles.row}><Text style={styles.label}>Delinquent on federal debt:</Text><Text style={styles.value}>{borrower.delinquent ? 'Yes' : 'No'}</Text></View>
            <View style={styles.row}><Text style={styles.label}>Alimony / child support:</Text><Text style={styles.value}>{borrower.alimony ? 'Yes' : 'No'}</Text></View>
            <View style={styles.row}><Text style={styles.label}>Down payment borrowed:</Text><Text style={styles.value}>{borrower.downPaymentBorrowed ? 'Yes' : 'No'}</Text></View>
            <View style={styles.row}><Text style={styles.label}>US Citizen:</Text><Text style={styles.value}>{borrower.usCitizen ? 'Yes' : 'No'}</Text></View>
          </View>

          {borrower.declarationsExplanation && (
            <View style={styles.section}>
              <Text style={styles.subHeader}>Explanations</Text>
              <Text style={{ marginTop: 8 }}>{borrower.declarationsExplanation}</Text>
            </View>
          )}

          {/* Attestation */}
          <View style={styles.section}>
            <Text style={styles.attestation}>
              I submit this application to become qualified and approved for a loan for the purposes indicated above. 
              I authorize the loan originator to share this application with any successors and/or assigns they deem necessary. 
              I hereby attest that all the information I have provided is true and accurate to the best of my knowledge.
            </Text>
          </View>

          {/* Signature */}
          <View style={{ marginTop: 40 }}>
            <Text style={{ fontSize: 10, marginBottom: 4 }}>Borrower's Signature</Text>
            <View style={styles.signatureLine} />
            <Text style={styles.signatureLabel}>Date</Text>
          </View>
        </Page>
      ))}
    </Document>
  );
}