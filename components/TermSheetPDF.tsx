import { Document, Page, Text, View, StyleSheet, Image } from '@react-pdf/renderer';

const styles = StyleSheet.create({
  page: {
    padding: 40,
    fontSize: 11,
    fontFamily: 'Helvetica',
    lineHeight: 1.5,
  },
  header: {
    fontSize: 24,
    marginBottom: 10,
    textAlign: 'center',
    fontWeight: 'bold',
    color: '#111827',
  },
  subHeader: {
    fontSize: 14,
    marginBottom: 15,
    padding: 10,
    backgroundColor: '#f3f4f6',
    fontWeight: 'bold',
    textAlign: 'center',
  },
  section: {
    marginBottom: 25,
  },
  row: {
    flexDirection: 'row',
    marginBottom: 8,
  },
  label: {
    width: '50%',
    fontWeight: 'bold',
  },
  value: {
    width: '50%',
  },
  signatureBox: {
    marginTop: 40,
    borderTop: '2 solid #111827',
    paddingTop: 10,
  },
  signatureImage: {
    width: 250,
    height: 80,
    marginBottom: 10,
  },
  footer: {
    marginTop: 50,
    fontSize: 9,
    textAlign: 'center',
    color: '#666',
  },
});

export function TermSheetPDF({ form, organization, isDSCR, signatureDataUrl }: any) {
  const orgName = organization?.name || 'CTF Funding';
  const logoUrl = organization?.logoUrl;

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* Header */}
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 20 }}>
          {logoUrl && <Image src={logoUrl} style={{ width: 80, height: 40, marginRight: 20 }} />}
          <Text style={styles.header}>{orgName} Term Sheet</Text>
        </View>

        <Text style={{ fontSize: 10, textAlign: 'center', marginBottom: 20, color: '#666' }}>
          Generated on {new Date().toLocaleDateString('en-US')}
        </Text>

        {/* Property & Borrower */}
        <View style={styles.section}>
          <Text style={styles.subHeader}>PROPERTY & BORROWER INFORMATION</Text>
          <View style={styles.row}>
            <Text style={styles.label}>Property Address:</Text>
            <Text style={styles.value}>{form.propertyAddress || form.property_address || 'N/A'}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Borrower Name:</Text>
            <Text style={styles.value}>{form.borrowerName || form.borrower_name || 'N/A'}</Text>
          </View>
        </View>

        {/* Loan Terms - Conditional */}
        <View style={styles.section}>
          <Text style={styles.subHeader}>{isDSCR ? 'DSCR LOAN TERMS' : 'LOAN TERMS'}</Text>
          <View style={styles.row}>
            <Text style={styles.label}>Loan Amount:</Text>
            <Text style={styles.value}>${form.loanAmount || form.loan_amount || '0'}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Interest Rate:</Text>
            <Text style={styles.value}>{form.interestRate || 'N/A'}%</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>LTV:</Text>
            <Text style={styles.value}>{form.ltv || 'N/A'}%</Text>
          </View>
          {isDSCR && (
            <View style={styles.row}>
              <Text style={styles.label}>Min DSCR:</Text>
              <Text style={styles.value}>1.25x</Text>
            </View>
          )}
        </View>

        {/* Signature */}
        <View style={styles.signatureBox}>
          <Text style={{ fontSize: 12, marginBottom: 8 }}>Borrower Signature</Text>
          {signatureDataUrl ? (
            <Image src={signatureDataUrl} style={styles.signatureImage} />
          ) : (
            <Text style={{ fontSize: 11, color: '#666', marginBottom: 20 }}>
              [Signature will appear here after signing]
            </Text>
          )}
          <Text style={{ fontSize: 10 }}>Date: {new Date().toLocaleDateString('en-US')}</Text>
        </View>

        <Text style={styles.footer}>
          This is a term sheet and not a commitment to lend. Subject to final inspection and approval.
        </Text>
      </Page>
    </Document>
  );
}