import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer';

const styles = StyleSheet.create({
  page: { padding: 40, fontSize: 10, fontFamily: 'Helvetica' },
  header: { fontSize: 18, marginBottom: 15, textAlign: 'center', fontWeight: 'bold' },
  subHeader: { fontSize: 14, marginBottom: 10, fontWeight: 'bold', backgroundColor: '#f0f0f0', padding: 8 },
  section: { marginBottom: 22 },
  row: { flexDirection: 'row', marginBottom: 6 },
  label: { width: '48%', fontWeight: 'bold' },
  value: { width: '52%' },
  title: { fontSize: 12, marginBottom: 6, fontWeight: 'bold' },
  table: { display: 'table', width: '100%', marginTop: 8 },
  tableRow: { flexDirection: 'row', borderBottom: '1 solid #ccc' },
  tableCell: { padding: 5, flex: 1 },
});

export function LoanApplicationPDF({ form, borrowers, rentRoll, owners }: any) {
  return (
    <Document>
      {/* PAGE 1 - Property & Financial Summary */}
      <Page size="A4" style={styles.page}>
        <Text style={styles.header}>CTF Funding Loan Application</Text>
        <Text style={{ fontSize: 10, textAlign: 'center', marginBottom: 20 }}>
          Generated on {new Date().toLocaleDateString()}
        </Text>

        <View style={styles.section}>
          <Text style={styles.subHeader}>PROPERTY INFORMATION</Text>
          <View style={styles.row}><Text style={styles.label}>Address:</Text><Text style={styles.value}>{form.propertyAddress}</Text></View>
          <View style={styles.row}><Text style={styles.label}>City:</Text><Text style={styles.value}>{form.city}</Text></View>
          <View style={styles.row}><Text style={styles.label}>County:</Text><Text style={styles.value}>{form.county}</Text></View>
          <View style={styles.row}><Text style={styles.label}>State / Zip:</Text><Text style={styles.value}>{form.state} {form.zip}</Text></View>
          <View style={styles.row}><Text style={styles.label}>Estimated Value:</Text><Text style={styles.value}>${form.estimatedValue}</Text></View>
          <View style={styles.row}><Text style={styles.label}>Number of Units:</Text><Text style={styles.value}>{form.units}</Text></View>
          <View style={styles.row}><Text style={styles.label}>Year Built:</Text><Text style={styles.value}>{form.yearBuilt}</Text></View>
          <View style={styles.row}><Text style={styles.label}>Square Footage:</Text><Text style={styles.value}>{form.sqFt}</Text></View>
        </View>

        <View style={styles.section}>
          <Text style={styles.subHeader}>FINANCIAL SUMMARY</Text>
          <View style={styles.row}><Text style={styles.label}>Annual Rental Income:</Text><Text style={styles.value}>${form.rentalIncome}</Text></View>
          <View style={styles.row}><Text style={styles.label}>Property Taxes (Annual):</Text><Text style={styles.value}>${form.taxes}</Text></View>
          <View style={styles.row}><Text style={styles.label}>Insurance (Annual):</Text><Text style={styles.value}>${form.insurance}</Text></View>
          <View style={styles.row}><Text style={styles.label}>HOA Fees (Annual):</Text><Text style={styles.value}>${form.hoa}</Text></View>
        </View>

        <View style={styles.section}>
          <Text style={styles.subHeader}>RENT ROLL</Text>
          <View style={styles.table}>
            <View style={styles.tableRow}>
              <Text style={[styles.tableCell, { fontWeight: 'bold' }]}>Unit</Text>
              <Text style={[styles.tableCell, { fontWeight: 'bold' }]}>Type</Text>
              <Text style={[styles.tableCell, { fontWeight: 'bold' }]}>Monthly Rent</Text>
            </View>
            {rentRoll?.map((r: any, i: number) => (
              <View key={i} style={styles.tableRow}>
                <Text style={styles.tableCell}>{r.unit}</Text>
                <Text style={styles.tableCell}>{r.type}</Text>
                <Text style={styles.tableCell}>${r.monthlyRent}</Text>
              </View>
            ))}
          </View>
        </View>
      </Page>

      {/* PAGE 2 - Loan Request & Purpose */}
      <Page size="A4" style={styles.page}>
        <Text style={styles.header}>Loan Request & Purpose</Text>

        <View style={styles.section}>
          <Text style={styles.subHeader}>LOAN REQUEST</Text>
          <View style={styles.row}><Text style={styles.label}>LTV Requested:</Text><Text style={styles.value}>{form.ltv}%</Text></View>
          <View style={styles.row}><Text style={styles.label}>Loan Amount:</Text><Text style={styles.value}>${form.loanAmount}</Text></View>
        </View>

        <View style={styles.section}>
          <Text style={styles.subHeader}>LOAN PURPOSE</Text>
          <Text>{form.acquisition ? 'Acquisition' : form.refinance ? 'Refinance' : form.cashOutRefi ? 'Cash-Out Refinance' : 'N/A'}</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.subHeader}>ENTITY INFORMATION</Text>
          <View style={styles.row}><Text style={styles.label}>Entity Name:</Text><Text style={styles.value}>{form.entityName || 'N/A'}</Text></View>
          <View style={styles.row}><Text style={styles.label}>Entity Type:</Text><Text style={styles.value}>{form.entityType || 'N/A'}</Text></View>
          <View style={styles.row}><Text style={styles.label}>Tax ID:</Text><Text style={styles.value}>{form.entityTaxId || 'N/A'}</Text></View>
          <View style={styles.row}><Text style={styles.label}>State Filed:</Text><Text style={styles.value}>{form.entityStateFiled || 'N/A'}</Text></View>
        </View>
      </Page>

      {/* Borrower Pages - Full Details */}
      {borrowers?.map((borrower: any, index: number) => (
        <Page key={index} size="A4" style={styles.page}>
          <Text style={styles.header}>Borrower {index + 1}</Text>

          <View style={styles.section}>
            <Text style={styles.subHeader}>BORROWER INFORMATION</Text>
            <View style={styles.row}><Text style={styles.label}>Full Name:</Text><Text style={styles.value}>{borrower.fullName}</Text></View>
            <View style={styles.row}><Text style={styles.label}>Date of Birth:</Text><Text style={styles.value}>{borrower.dateOfBirth}</Text></View>
            <View style={styles.row}><Text style={styles.label}>Social Security:</Text><Text style={styles.value}>{borrower.socialSecurity}</Text></View>
            <View style={styles.row}><Text style={styles.label}>Full Home Address:</Text><Text style={styles.value}>{borrower.fullHomeAddress}</Text></View>
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
              <Text>{borrower.declarationsExplanation}</Text>
            </View>
          )}
        </Page>
      ))}
    </Document>
  );
}